
require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

const fs = require("fs");
const path = require("path");
const http = require("http");

const commands = require("./commands");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN) {
  console.error("❌ A variável DISCORD_TOKEN não está configurada.");
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "database.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return { guilds: {} };
    }

    const raw = fs.readFileSync(DB_FILE, "utf8");
    const parsed = JSON.parse(raw);

    if (!parsed.guilds || typeof parsed.guilds !== "object") {
      parsed.guilds = {};
    }

    return parsed;
  } catch (error) {
    console.error("❌ Erro ao carregar o banco:", error);
    return { guilds: {} };
  }
}

let db = loadDB();

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (error) {
    console.error("❌ Erro ao salvar o banco:", error);
  }
}

function guildConfig(guild) {
  if (!db.guilds[guild.id]) {
    db.guilds[guild.id] = {};
  }

  const cfg = db.guilds[guild.id];

  if (!Array.isArray(cfg.blacklist)) cfg.blacklist = [];
  if (!Array.isArray(cfg.whitelist)) cfg.whitelist = [];
  if (!Array.isArray(cfg.feedbacks)) cfg.feedbacks = [];
  if (!Array.isArray(cfg.warns)) cfg.warns = [];

  if (typeof cfg.zenithOwner === "undefined") {
    cfg.zenithOwner = null;
  }

  if (typeof cfg.logs === "undefined") cfg.logs = null;
  if (typeof cfg.ticketCategory === "undefined") {
    cfg.ticketCategory = null;
  }
  if (typeof cfg.ticketPanelChannel === "undefined") {
    cfg.ticketPanelChannel = null;
  }

  if (!cfg.antiraid || typeof cfg.antiraid !== "object") {
    cfg.antiraid = { enabled: false };
  }

  if (!cfg.antispam || typeof cfg.antispam !== "object") {
    cfg.antispam = { enabled: false };
  }

  if (!cfg.botProtection || typeof cfg.botProtection !== "object") {
    cfg.botProtection = { enabled: false };
  }

  if (!cfg.lockdown || typeof cfg.lockdown !== "object") {
    cfg.lockdown = { enabled: false };
  }

  if (!cfg.ticketPanel || typeof cfg.ticketPanel !== "object") {
    cfg.ticketPanel = { enabled: false };
  }

  // Configuração do sistema de boas-vindas
  if (!cfg.welcome || typeof cfg.welcome !== "object") {
    cfg.welcome = {
      enabled: false,
      channelId: null,
      message: "Esperamos que você se divirta com a gente!"
    };
  }

  if (typeof cfg.welcome.enabled !== "boolean") {
    cfg.welcome.enabled = false;
  }

  if (!cfg.welcome.channelId) {
    cfg.welcome.channelId = null;
  }

  if (!cfg.welcome.message) {
    cfg.welcome.message =
      "Esperamos que você se divirta com a gente!";
  }

  saveDB();
  return cfg;
}

function isZenithOwner(interaction) {
  const cfg = guildConfig(interaction.guild);

  return Boolean(
    interaction.user &&
    cfg.zenithOwner &&
    interaction.user.id === cfg.zenithOwner
  );
}

function createBasicEmbed(title, description, color = 0x5865F2) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp()
    .setFooter({ text: "Zenith • Sistema de gerenciamento" });
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration
  ],
  partials: [
    Partials.Channel,
    Partials.GuildMember,
    Partials.User,
    Partials.Message
  ]
});

/* =========================================
   PARTE 2/5 — LOGS E BOAS-VINDAS
========================================= */

/* ---------- SISTEMA DE LOGS ---------- */

async function sendLog(guild, title, description, color = 0x5865F2) {
  try {
    const cfg = guildConfig(guild);

    if (!cfg.logs) return;

    const channel = await guild.channels
      .fetch(cfg.logs)
      .catch(() => null);

    if (!channel || !channel.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(description)
      .setFooter({ text: "Zenith • Registro de atividades" })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("[LOG ERROR]", error);
  }
}

/* ---------- EMBED DE BOAS-VINDAS ---------- */

function createWelcomeEmbed(member, message) {
  const guild = member.guild;

  const description = String(
    message || "Esperamos que você se divirta com a gente!"
  )
    .replaceAll("{user}", `<@${member.id}>`)
    .replaceAll("{server}", guild.name)
    .replaceAll("{count}", String(guild.memberCount));

  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setAuthor({
      name: "NOVO MEMBRO • ZENITH",
      iconURL: guild.iconURL({ size: 128 }) || undefined
    })
    .setTitle("🎉 Seja bem-vindo(a)!")
    .setDescription(
      `${description}\n\n` +
      `👤 **Membro:** ${member}\n` +
      `📊 **Membro número:** ${guild.memberCount}`
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({
      text: `${guild.name} • Boas-vindas`
    })
    .setTimestamp();
}

/* ---------- ENVIO DE BOAS-VINDAS ---------- */

async function sendWelcome(member) {
  try {
    if (!member || !member.guild || member.user.bot) return;

    const cfg = guildConfig(member.guild);
    const welcome = cfg.welcome;

    if (!welcome.enabled || !welcome.channelId) return;

    const channel = await member.guild.channels
      .fetch(welcome.channelId)
      .catch(() => null);

    if (!channel || !channel.isTextBased()) {
      console.warn(
        `[WELCOME] Canal inválido no servidor ${member.guild.id}`
      );
      return;
    }

    await channel.send({
      embeds: [
        createWelcomeEmbed(member, welcome.message)
      ],
      allowedMentions: {
        users: [member.id]
      }
    });

    console.log(
      `[WELCOME] Boas-vindas enviadas para ${member.user.tag}`
    );
  } catch (error) {
    console.error("[WELCOME ERROR]", error);
  }
}

/* ---------- EMBED DO PAINEL DE TICKETS ---------- */

function createTicketPanelEmbed(guild) {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setAuthor({
      name: "ZENITH • CENTRAL DE ATENDIMENTO",
      iconURL: guild.iconURL({ size: 128 }) || undefined
    })
    .setTitle("🎫 Precisa de ajuda?")
    .setDescription(
      "Nossa equipe está pronta para ajudar você!\n\n" +
      "Selecione abaixo o tipo de atendimento desejado.\n\n" +
      "🛠️ **Suporte**\n" +
      "Tire dúvidas ou relate problemas.\n\n" +
      "🚨 **Denúncia**\n" +
      "Reporte jogadores ou situações inadequadas.\n\n" +
      "❓ **Dúvida**\n" +
      "Faça uma pergunta à nossa equipe.\n\n" +
      "🛒 **Compras**\n" +
      "Receba atendimento sobre compras."
    )
    .setFooter({
      text: "Zenith • Atendimento"
    })
    .setTimestamp();
}

/* ---------- BOTÕES DO PAINEL DE TICKETS ---------- */

function createTicketPanelComponents() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_open_suporte")
      .setLabel("Suporte")
      .setEmoji("🛠️")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("ticket_open_denuncia")
      .setLabel("Denúncia")
      .setEmoji("🚨")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId("ticket_open_duvida")
      .setLabel("Dúvida")
      .setEmoji("❓")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("ticket_open_compras")
      .setLabel("Compras")
      .setEmoji("🛒")
      .setStyle(ButtonStyle.Success)
  );

  return [row];
}

/* ---------- EMBED PRIVADA DO TICKET ---------- */

function createTicketEmbed(user, type) {
  const names = {
    suporte: "🛠️ Suporte",
    denuncia: "🚨 Denúncia",
    duvida: "❓ Dúvida",
    compras: "🛒 Compras"
  };

  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setAuthor({
      name: "ZENITH • ATENDIMENTO"
    })
    .setTitle("🎫 Ticket aberto")
    .setDescription(
      `Olá ${user}!\n\n` +
      "Sua solicitação foi registrada. Explique abaixo como nossa equipe pode ajudar.\n\n" +
      `**Categoria:** ${names[type] || "Atendimento"}\n` +
      `**Solicitante:** ${user}\n\n` +
      "Nossa equipe responderá assim que possível."
    )
    .setFooter({
      text: "Zenith • Atendimento"
    })
    .setTimestamp();
}

/* ---------- BOTÕES INTERNOS DO TICKET ---------- */

function createTicketControlComponents() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel("Fechar")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId("ticket_claim")
      .setLabel("Assumir")
      .setEmoji("🙋")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("ticket_add_member")
      .setLabel("Adicionar membro")
      .setEmoji("➕")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("ticket_remove_member")
      .setLabel("Remover membro")
      .setEmoji("➖")
      .setStyle(ButtonStyle.Secondary)
  );

  return [row];
}

/* ---------- VERIFICAÇÕES DE PERMISSÃO ---------- */

function isAdministrator(member) {
  return Boolean(
    member?.permissions?.has(PermissionFlagsBits.Administrator)
  );
}

function getAdministratorRole(guild) {
  return guild.roles.cache.find(
    role => role.name === "🛡️ Administrador"
  ) || null;
}

function canManageTicket(member, guild) {
  if (!member) return false;

  if (isAdministrator(member)) return true;

  const adminRole = getAdministratorRole(guild);

  return Boolean(adminRole && member.roles.cache.has(adminRole.id));
}

/* ---------- NORMALIZAÇÃO DE NOMES ---------- */

function normalizeChannelName(value) {
  return String(value || "usuario")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "usuario";
}

/* ---------- CONTROLE DE ANTISPAM ---------- */

const spamTracker = new Map();

function registerMessageForSpam(message) {
  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();

  const history = spamTracker.get(key) || [];
  const recent = history.filter(timestamp => now - timestamp <= 5000);

  recent.push(now);
  spamTracker.set(key, recent);

  return recent.length;
}

/* ---------- CONTROLE DE ANTIRAID ---------- */

const joinTracker = new Map();

function registerJoinForRaid(guildId) {
  const now = Date.now();
  const history = joinTracker.get(guildId) || [];
  const recent = history.filter(timestamp => now - timestamp <= 10000);

  recent.push(now);
  joinTracker.set(guildId, recent);

  return recent.length;
}

/* ---------- FIM DA PARTE 2/5 ---------- */

/* =========================================
   PARTE 3/5 — SISTEMA DE TICKETS
========================================= */

const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

/* ---------- CRIAR CANAL PRIVADO ---------- */

async function createTicketChannel(interaction, type) {
  const guild = interaction.guild;
  const user = interaction.user;
  const cfg = guildConfig(guild);

  const validTypes = [
    "suporte",
    "denuncia",
    "duvida",
    "compras"
  ];

  if (!validTypes.includes(type)) {
    return interaction.reply({
      content: "❌ Categoria de ticket inválida.",
      ephemeral: true
    });
  }

  const existingTicket = guild.channels.cache.find(channel =>
    channel.type === ChannelType.GuildText &&
    channel.topic?.includes(`ticket-owner:${user.id}`)
  );

  if (existingTicket) {
    return interaction.reply({
      content: `❌ Você já possui um ticket aberto: ${existingTicket}`,
      ephemeral: true
    });
  }

  let category = null;

  if (cfg.ticketCategory) {
    category = await guild.channels
      .fetch(cfg.ticketCategory)
      .catch(() => null);

    if (!category || category.type !== ChannelType.GuildCategory) {
      category = null;
    }
  }

  const adminRole = getAdministratorRole(guild);

  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    },
    {
      id: client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages
      ]
    }
  ];

  if (adminRole) {
    permissionOverwrites.push({
      id: adminRole.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles
      ]
    });
  }

  let channel;

  try {
    channel = await guild.channels.create({
      name: `${type}-${normalizeChannelName(user.username)}`,
      type: ChannelType.GuildText,
      topic: `ticket-owner:${user.id} | ticket-type:${type}`,
      parent: category?.id || undefined,
      permissionOverwrites,
      reason: `Ticket ${type} aberto por ${user.tag}`
    });
  } catch (error) {
    console.error("[TICKET CREATE ERROR]", error);

    return interaction.reply({
      content:
        "❌ Não consegui criar o ticket. Verifique as permissões do bot.",
      ephemeral: true
    });
  }

  try {
    await channel.send({
      content: `${user}`,
      embeds: [createTicketEmbed(user, type)],
      components: createTicketControlComponents(),
      allowedMentions: {
        users: [user.id]
      }
    });

    await sendLog(
      guild,
      "🎫 Ticket criado",
      `**Canal:** ${channel}\n**Usuário:** ${user}\n**Categoria:** ${type}`
    );

    return interaction.reply({
      content: `✅ Seu ticket foi criado: ${channel}`,
      ephemeral: true
    });
  } catch (error) {
    console.error("[TICKET MESSAGE ERROR]", error);

    await channel.delete("Falha ao enviar a mensagem inicial do ticket")
      .catch(() => null);

    return interaction.reply({
      content:
        "❌ O canal foi criado, mas não consegui enviar a mensagem do ticket. Confira as permissões do bot.",
      ephemeral: true
    });
  }
}

/* ---------- IDENTIFICAR CANAL DE TICKET ---------- */

function isTicketChannel(channel) {
  return Boolean(
    channel &&
    channel.type === ChannelType.GuildText &&
    typeof channel.topic === "string" &&
    channel.topic.includes("ticket-owner:")
  );
}

function getTicketOwnerId(channel) {
  if (!isTicketChannel(channel)) return null;

  const match = channel.topic.match(/ticket-owner:(\d{17,20})/);

  return match ? match[1] : null;
}

/* ---------- FECHAR E EXCLUIR TICKET ---------- */

async function closeTicket(interaction) {
  const channel = interaction.channel;

  if (!isTicketChannel(channel)) {
    return interaction.reply({
      content: "❌ Este canal não é um ticket do Zenith.",
      ephemeral: true
    });
  }

  const ownerId = getTicketOwnerId(channel);

  await interaction.reply({
    content: "🔒 Ticket fechado. O canal será excluído em alguns segundos.",
    ephemeral: true
  });

  await sendLog(
    interaction.guild,
    "🔒 Ticket fechado",
    `**Canal:** #${channel.name}\n` +
    `**Solicitante:** ${ownerId ? `<@${ownerId}>` : "Desconhecido"}\n` +
    `**Fechado por:** ${interaction.user}`
  );

  setTimeout(async () => {
    await channel.delete(
      `Ticket fechado por ${interaction.user.tag}`
    ).catch(error => {
      console.error("[TICKET DELETE ERROR]", error);
    });
  }, 3000);
}

/* ---------- ASSUMIR TICKET ---------- */

async function claimTicket(interaction) {
  const channel = interaction.channel;

  if (!isTicketChannel(channel)) {
    return interaction.reply({
      content: "❌ Este canal não é um ticket do Zenith.",
      ephemeral: true
    });
  }

  if (!canManageTicket(interaction.member, interaction.guild)) {
    return interaction.reply({
      content: "❌ Apenas a equipe administrativa pode assumir tickets.",
      ephemeral: true
    });
  }

  if (channel.topic.includes("ticket-claimed:")) {
    return interaction.reply({
      content: "⚠️ Este ticket já foi assumido.",
      ephemeral: true
    });
  }

  const newTopic =
    `${channel.topic} | ticket-claimed:${interaction.user.id}`;

  try {
    await channel.setTopic(newTopic);

    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setDescription(
        `🙋 Este ticket foi assumido por ${interaction.user}.`
      )
      .setTimestamp();

    await interaction.reply({
      embeds: [embed]
    });

    await sendLog(
      interaction.guild,
      "🙋 Ticket assumido",
      `**Canal:** ${channel}\n**Responsável:** ${interaction.user}`
    );
  } catch (error) {
    console.error("[TICKET CLAIM ERROR]", error);

    return interaction.reply({
      content: "❌ Não consegui assumir o ticket. Verifique as permissões.",
      ephemeral: true
    });
  }
}

/* ---------- MODAL PARA ADICIONAR MEMBRO ---------- */

function createTicketMemberModal(action) {
  const isAdd = action === "add";

  const modal = new ModalBuilder()
    .setCustomId(
      isAdd ? "ticket_add_member_modal" : "ticket_remove_member_modal"
    )
    .setTitle(isAdd ? "Adicionar membro" : "Remover membro");

  const memberInput = new TextInputBuilder()
    .setCustomId("member_id")
    .setLabel("ID do usuário no Discord")
    .setPlaceholder("Ex.: 123456789012345678")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(17)
    .setMaxLength(20);

  modal.addComponents(
    new ActionRowBuilder().addComponents(memberInput)
  );

  return modal;
}

/* ---------- ADICIONAR MEMBRO AO TICKET ---------- */

async function addMemberToTicket(interaction, memberId) {
  const channel = interaction.channel;

  if (!isTicketChannel(channel)) {
    return interaction.reply({
      content: "❌ Este canal não é um ticket do Zenith.",
      ephemeral: true
    });
  }

  if (!canManageTicket(interaction.member, interaction.guild)) {
    return interaction.reply({
      content: "❌ Apenas o cargo 🛡️ Administrador pode usar este botão.",
      ephemeral: true
    });
  }

  if (!/^\d{17,20}$/.test(memberId)) {
    return interaction.reply({
      content: "❌ Informe um ID de usuário válido.",
      ephemeral: true
    });
  }

  const member = await interaction.guild.members
    .fetch(memberId)
    .catch(() => null);

  if (!member) {
    return interaction.reply({
      content: "❌ Não encontrei esse usuário neste servidor.",
      ephemeral: true
    });
  }

  try {
    await channel.permissionOverwrites.edit(member.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true
    });

    await interaction.reply({
      content: `✅ ${member} agora tem acesso a este ticket.`,
      ephemeral: true
    });

    await channel.send({
      embeds: [
        createBasicEmbed(
          "➕ Membro adicionado",
          `${member} recebeu acesso ao ticket.`
        )
      ]
    });

    await sendLog(
      interaction.guild,
      "➕ Membro adicionado ao ticket",
      `**Canal:** ${channel}\n**Membro:** ${member}\n**Por:** ${interaction.user}`
    );
  } catch (error) {
    console.error("[TICKET ADD MEMBER ERROR]", error);

    if (!interaction.replied) {
      await interaction.reply({
        content: "❌ Não consegui adicionar o membro. Confira as permissões.",
        ephemeral: true
      });
    }
  }
}

/* ---------- REMOVER MEMBRO DO TICKET ---------- */

async function removeMemberFromTicket(interaction, memberId) {
  const channel = interaction.channel;

  if (!isTicketChannel(channel)) {
    return interaction.reply({
      content: "❌ Este canal não é um ticket do Zenith.",
      ephemeral: true
    });
  }

  if (!canManageTicket(interaction.member, interaction.guild)) {
    return interaction.reply({
      content: "❌ Apenas o cargo 🛡️ Administrador pode usar este botão.",
      ephemeral: true
    });
  }

  if (!/^\d{17,20}$/.test(memberId)) {
    return interaction.reply({
      content: "❌ Informe um ID de usuário válido.",
      ephemeral: true
    });
  }

  const ownerId = getTicketOwnerId(channel);

  if (memberId === ownerId) {
    return interaction.reply({
      content: "❌ Não é permitido remover o criador do ticket.",
      ephemeral: true
    });
  }

  const member = await interaction.guild.members
    .fetch(memberId)
    .catch(() => null);

  if (!member) {
    return interaction.reply({
      content: "❌ Não encontrei esse usuário neste servidor.",
      ephemeral: true
    });
  }

  try {
    await channel.permissionOverwrites.delete(
      member.id,
      `Membro removido do ticket por ${interaction.user.tag}`
    );

    await interaction.reply({
      content: `✅ O acesso de ${member} foi removido.`,
      ephemeral: true
    });

    await channel.send({
      embeds: [
        createBasicEmbed(
          "➖ Acesso removido",
          `O acesso de ${member} a este ticket foi removido.`
        )
      ]
    });

    await sendLog(
      interaction.guild,
      "➖ Membro removido do ticket",
      `**Canal:** ${channel}\n**Membro:** ${member}\n**Por:** ${interaction.user}`
    );
  } catch (error) {
    console.error("[TICKET REMOVE MEMBER ERROR]", error);

    if (!interaction.replied) {
      await interaction.reply({
        content: "❌ Não consegui remover o membro. Confira as permissões.",
        ephemeral: true
      });
    }
  }
}

/* ---------- FIM DA PARTE 3/5 ---------- */

/* =========================================
   PARTE 4/5 — COMANDOS E INTERAÇÕES
========================================= */

/* ---------- TRATAMENTO DE INTERAÇÕES ---------- */

client.on("interactionCreate", async interaction => {
  try {
    /* ---------- BOTÕES ---------- */

    if (interaction.isButton()) {
      const id = interaction.customId;

      // Abrir ticket
      if (id.startsWith("ticket_open_")) {
        const type = id.replace("ticket_open_", "");

        return await createTicketChannel(interaction, type);
      }

      // Fechar ticket: qualquer pessoa com acesso ao canal
      if (id === "ticket_close") {
        return await closeTicket(interaction);
      }

      // Ações administrativas
      if (id === "ticket_claim") {
        return await claimTicket(interaction);
      }

      if (id === "ticket_add_member") {
        if (!canManageTicket(interaction.member, interaction.guild)) {
          return interaction.reply({
            content: "❌ Apenas a equipe administrativa pode usar este botão.",
            ephemeral: true
          });
        }

        return await interaction.showModal(
          createTicketMemberModal("add")
        );
      }

      if (id === "ticket_remove_member") {
        if (!canManageTicket(interaction.member, interaction.guild)) {
          return interaction.reply({
            content: "❌ Apenas a equipe administrativa pode usar este botão.",
            ephemeral: true
          });
        }

        return await interaction.showModal(
          createTicketMemberModal("remove")
        );
      }

      return;
    }

    /* ---------- FORMULÁRIOS DOS TICKETS ---------- */

    if (interaction.isModalSubmit()) {
      if (interaction.customId === "ticket_add_member_modal") {
        const memberId = interaction.fields.getTextInputValue("member_id");

        return await addMemberToTicket(interaction, memberId);
      }

      if (interaction.customId === "ticket_remove_member_modal") {
        const memberId = interaction.fields.getTextInputValue("member_id");

        return await removeMemberFromTicket(interaction, memberId);
      }

      return;
    }

    /* ---------- COMANDOS SLASH ---------- */

    if (!interaction.isChatInputCommand()) return;

    if (!interaction.guild) {
      return interaction.reply({
        content: "❌ Este comando só pode ser usado em um servidor.",
        ephemeral: true
      });
    }

    const guild = interaction.guild;
    const cfg = guildConfig(guild);
    const command = interaction.commandName;

    /* ---------- BOAS-VINDAS ---------- */

    if (command === "welcome") {
      if (!isAdministrator(interaction.member)) {
        return interaction.reply({
          content: "❌ Você precisa ser administrador do servidor.",
          ephemeral: true
        });
      }

      const sub = interaction.options.getSubcommand();

      if (sub === "configurar") {
        const channel = interaction.options.getChannel("canal");
        const message = interaction.options.getString("mensagem");

        if (
          !channel ||
          channel.type !== ChannelType.GuildText
        ) {
          return interaction.reply({
            content: "❌ Selecione um canal de texto válido.",
            ephemeral: true
          });
        }

        cfg.welcome.enabled = true;
        cfg.welcome.channelId = channel.id;
        cfg.welcome.message =
          message || "Esperamos que você se divirta com a gente!";

        saveDB();

        return interaction.reply({
          content:
            `✅ Sistema de boas-vindas ativado em ${channel}!\n\n` +
            "Variáveis disponíveis: `{user}`, `{server}` e `{count}`.",
          ephemeral: true
        });
      }

      if (sub === "desativar") {
        cfg.welcome.enabled = false;
        saveDB();

        return interaction.reply({
          content: "🔕 Sistema de boas-vindas desativado.",
          ephemeral: true
        });
      }

      if (sub === "testar") {
        if (!cfg.welcome.enabled || !cfg.welcome.channelId) {
          return interaction.reply({
            content: "❌ Configure primeiro usando `/welcome configurar`.",
            ephemeral: true
          });
        }

        const channel = await guild.channels
          .fetch(cfg.welcome.channelId)
          .catch(() => null);

        if (!channel || !channel.isTextBased()) {
          return interaction.reply({
            content: "❌ O canal configurado não existe ou não está acessível.",
            ephemeral: true
          });
        }

        const embed = createWelcomeEmbed(
          interaction.member,
          cfg.welcome.message
        );

        return interaction.reply({
          content: `Prévia das boas-vindas para ${interaction.user}:`,
          embeds: [embed],
          ephemeral: true
        });
      }

      return;
    }

    /* ---------- INFORMAÇÕES ---------- */

    if (command === "info") {
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("🤖 Zenith")
        .setDescription(
          "Bot de gerenciamento, atendimento e segurança para Discord."
        )
        .addFields(
          {
            name: "🏠 Servidores",
            value: String(client.guilds.cache.size),
            inline: true
          },
          {
            name: "👥 Usuários em cache",
            value: String(client.users.cache.size),
            inline: true
          },
          {
            name: "📡 Latência",
            value: `${client.ws.ping} ms`,
            inline: true
          }
        )
        .setTimestamp()
        .setFooter({ text: "Zenith • Informações" });

      return interaction.reply({ embeds: [embed] });
    }

    /* ---------- CONFIGURAÇÃO DO DONO ---------- */

    if (command === "config") {
      if (!interaction.memberPermissions?.has(
        PermissionFlagsBits.Administrator
      )) {
        return interaction.reply({
          content: "❌ Você precisa ser administrador.",
          ephemeral: true
        });
      }

      const sub = interaction.options.getSubcommand(false);

      if (sub === "owner") {
        cfg.zenithOwner = interaction.user.id;
        saveDB();

        return interaction.reply({
          content: "✅ Você foi definido como responsável pelo Zenith neste servidor.",
          ephemeral: true
        });
      }

      return interaction.reply({
        content: "⚙️ Utilize as opções disponíveis no comando `/config`.",
        ephemeral: true
      });
    }

    /* ---------- PERMISSÃO PARA COMANDOS RESTRITOS ---------- */

    const restrictedCommands = [
      "setup",
      "ticket",
      "security",
      "blacklist",
      "whitelist",
      "logs",
      "lockdown",
      "ban",
      "kick",
      "warn"
    ];

    if (
      restrictedCommands.includes(command) &&
      !isZenithOwner(interaction) &&
      !interaction.memberPermissions?.has(
        PermissionFlagsBits.Administrator
      )
    ) {
      return interaction.reply({
        content:
          "❌ Você não tem permissão para usar este comando. " +
          "Peça ao responsável pelo Zenith para configurar o acesso.",
        ephemeral: true
      });
    }

    /* ---------- SETUP DO SERVIDOR ---------- */

    if (command === "setup") {
      const sub = interaction.options.getSubcommand(false);

      if (sub === "owner") {
        cfg.zenithOwner = interaction.user.id;
        saveDB();

        return interaction.reply({
          content: "✅ Você foi definido como responsável pelo Zenith.",
          ephemeral: true
        });
      }

      const category = interaction.options.getChannel("categoria");
      const logs = interaction.options.getChannel("logs");

      if (category) {
        if (category.type !== ChannelType.GuildCategory) {
          return interaction.reply({
            content: "❌ Selecione uma categoria de canais válida.",
            ephemeral: true
          });
        }

        cfg.ticketCategory = category.id;
      }

      if (logs) {
        if (logs.type !== ChannelType.GuildText) {
          return interaction.reply({
            content: "❌ Selecione um canal de texto para os logs.",
            ephemeral: true
          });
        }

        cfg.logs = logs.id;
      }

      saveDB();

      return interaction.reply({
        content:
          "✅ Configuração salva.\n" +
          (category ? `📁 Categoria dos tickets: ${category}\n` : "") +
          (logs ? `📋 Canal de logs: ${logs}` : ""),
        ephemeral: true
      });
    }

    /* ---------- PAINEL DE TICKETS ---------- */

    if (command === "ticket") {
      const sub = interaction.options.getSubcommand(false);

      if (sub === "configurar") {
        const category = interaction.options.getChannel("categoria");
        const panelChannel = interaction.options.getChannel("canal");

        if (category) {
          if (category.type !== ChannelType.GuildCategory) {
            return interaction.reply({
              content: "❌ A categoria selecionada é inválida.",
              ephemeral: true
            });
          }

          cfg.ticketCategory = category.id;
        }

        const destination = panelChannel || interaction.channel;

        if (!destination || destination.type !== ChannelType.GuildText) {
          return interaction.reply({
            content: "❌ Selecione um canal de texto válido.",
            ephemeral: true
          });
        }

        cfg.ticketPanelChannel = destination.id;
        cfg.ticketPanel = { enabled: true };
        saveDB();

        await destination.send({
          embeds: [createTicketPanelEmbed(guild)],
          components: createTicketPanelComponents()
        });

        return interaction.reply({
          content: `✅ Painel de tickets enviado em ${destination}.`,
          ephemeral: true
        });
      }

      // Sem subcomando: envia o painel no canal atual.
      cfg.ticketPanelChannel = interaction.channelId;
      cfg.ticketPanel = { enabled: true };
      saveDB();

      await interaction.channel.send({
        embeds: [createTicketPanelEmbed(guild)],
        components: createTicketPanelComponents()
      });

      return interaction.reply({
        content: "✅ Painel de atendimento enviado.",
        ephemeral: true
      });
    }

    /* ---------- CANAL DE LOGS ---------- */

    if (command === "logs") {
      const channel = interaction.options.getChannel("canal");

      if (!channel || channel.type !== ChannelType.GuildText) {
        return interaction.reply({
          content: "❌ Informe um canal de texto válido.",
          ephemeral: true
        });
      }

      cfg.logs = channel.id;
      saveDB();

      return interaction.reply({
        content: `✅ Canal de logs configurado: ${channel}`,
        ephemeral: true
      });
    }

    /* ---------- SEGURANÇA ---------- */

    if (command === "security") {
      const sub = interaction.options.getSubcommand(false);
      const enabled = interaction.options.getBoolean("ativado");

      if (sub === "antispam") {
        cfg.antispam.enabled = enabled ?? !cfg.antispam.enabled;
      } else if (sub === "antiraid") {
        cfg.antiraid.enabled = enabled ?? !cfg.antiraid.enabled;
      } else if (sub === "botprotection") {
        cfg.botProtection.enabled =
          enabled ?? !cfg.botProtection.enabled;
      } else {
        return interaction.reply({
          content: "❌ Selecione uma opção de segurança válida.",
          ephemeral: true
        });
      }

      saveDB();

      return interaction.reply({
        content: `✅ Configuração de segurança atualizada: ${sub}.`,
        ephemeral: true
      });
    }

    /* ---------- BLACKLIST ---------- */

    if (command === "blacklist") {
      const user = interaction.options.getUser("usuario");
      const action = interaction.options.getSubcommand(false);

      if (!user) {
        return interaction.reply({
          content: "❌ Informe o usuário.",
          ephemeral: true
        });
      }

      if (action === "remover") {
        cfg.blacklist = cfg.blacklist.filter(id => id !== user.id);

        saveDB();

        return interaction.reply({
          content: `✅ ${user} foi removido da blacklist.`,
          ephemeral: true
        });
      }

      if (!cfg.blacklist.includes(user.id)) {
        cfg.blacklist.push(user.id);
      }

      saveDB();

      return interaction.reply({
        content: `⛔ ${user} foi adicionado à blacklist.`,
        ephemeral: true
      });
    }

    /* ---------- WHITELIST ---------- */

    if (command === "whitelist") {
      const user = interaction.options.getUser("usuario");
      const action = interaction.options.getSubcommand(false);

      if (!user) {
        return interaction.reply({
          content: "❌ Informe o usuário.",
          ephemeral: true
        });
      }

      if (action === "remover") {
        cfg.whitelist = cfg.whitelist.filter(id => id !== user.id);

        saveDB();

        return interaction.reply({
          content: `✅ ${user} foi removido da whitelist.`,
          ephemeral: true
        });
      }

      if (!cfg.whitelist.includes(user.id)) {
        cfg.whitelist.push(user.id);
      }

      saveDB();

      return interaction.reply({
        content: `✅ ${user} foi adicionado à whitelist.`,
        ephemeral: true
      });
    }

    /* ---------- LOCKDOWN ---------- */

    if (command === "lockdown") {
      const enabled = interaction.options.getBoolean("ativado");
      cfg.lockdown.enabled = enabled ?? !cfg.lockdown.enabled;

      saveDB();

      return interaction.reply({
        content: cfg.lockdown.enabled
          ? "🔒 Lockdown ativado na configuração do servidor."
          : "🔓 Lockdown desativado na configuração do servidor.",
        ephemeral: true
      });
    }

    /* ---------- MODERAÇÃO: BAN ---------- */

    if (command === "ban") {
      const user = interaction.options.getUser("usuario");
      const reason =
        interaction.options.getString("motivo") || "Sem motivo informado";

      if (!user) {
        return interaction.reply({
          content: "❌ Informe o usuário que deseja banir.",
          ephemeral: true
        });
      }

      const member = await guild.members.fetch(user.id).catch(() => null);

      if (member && !member.bannable) {
        return interaction.reply({
          content: "❌ Não consigo banir esse membro. Confira a hierarquia de cargos.",
          ephemeral: true
        });
      }

      await guild.members.ban(user.id, { reason });

      await sendLog(
        guild,
        "🔨 Membro banido",
        `**Usuário:** ${user.tag}\n**Moderador:** ${interaction.user}\n**Motivo:** ${reason}`,
        0xED4245
      );

      return interaction.reply({
        content: `🔨 ${user.tag} foi banido.\nMotivo: ${reason}`,
        ephemeral: true
      });
    }

    /* ---------- MODERAÇÃO: KICK ---------- */

    if (command === "kick") {
      const user = interaction.options.getUser("usuario");
      const reason =
        interaction.options.getString("motivo") || "Sem motivo informado";

      if (!user) {
        return interaction.reply({
          content: "❌ Informe o usuário que deseja expulsar.",
          ephemeral: true
        });
      }

      const member = await guild.members.fetch(user.id).catch(() => null);

      if (!member || !member.kickable) {
        return interaction.reply({
          content: "❌ Não consigo expulsar esse membro.",
          ephemeral: true
        });
      }

      await member.kick(reason);

      await sendLog(
        guild,
        "👢 Membro expulso",
        `**Usuário:** ${user.tag}\n**Moderador:** ${interaction.user}\n**Motivo:** ${reason}`,
        0xED4245
      );

      return interaction.reply({
        content: `👢 ${user.tag} foi expulso.`,
        ephemeral: true
      });
    }

    /* ---------- MODERAÇÃO: WARN ---------- */

    if (command === "warn") {
      const user = interaction.options.getUser("usuario");
      const reason =
        interaction.options.getString("motivo") || "Sem motivo informado";

      if (!user) {
        return interaction.reply({
          content: "❌ Informe o usuário que deseja advertir.",
          ephemeral: true
        });
      }

      cfg.warns.push({
        userId: user.id,
        moderatorId: interaction.user.id,
        reason,
        date: new Date().toISOString()
      });

      saveDB();

      await sendLog(
        guild,
        "⚠️ Advertência aplicada",
        `**Usuário:** ${user.tag}\n**Moderador:** ${interaction.user}\n**Motivo:** ${reason}`,
        0xFEE75C
      );

      return interaction.reply({
        content: `⚠️ ${user.tag} recebeu uma advertência.\nMotivo: ${reason}`,
        ephemeral: true
      });
    }

    /* ---------- COMANDO NÃO IMPLEMENTADO ---------- */

    return interaction.reply({
      content:
        `⚠️ O comando \`/${command}\` ainda não possui uma implementação neste arquivo.`,
      ephemeral: true
    });

  } catch (error) {
    console.error("[INTERACTION ERROR]", error);

    const response = {
      content:
        "❌ Ocorreu um erro ao executar essa interação. Confira os logs do bot.",
      ephemeral: true
    };

    if (interaction.deferred) {
      await interaction.editReply(response).catch(() => null);
    } else if (interaction.replied) {
      await interaction.followUp(response).catch(() => null);
    } else {
      await interaction.reply(response).catch(() => null);
    }
  }
});

/* ---------- FIM DA PARTE 4/5 ---------- */

/* =========================================
   PARTE 5/5 — EVENTOS E INICIALIZAÇÃO
========================================= */

/* ---------- MEMBROS ENTRANDO NO SERVIDOR ---------- */

client.on("guildMemberAdd", async member => {
  try {
    const guild = member.guild;
    const cfg = guildConfig(guild);

    // Bloquear usuários na blacklist
    if (cfg.blacklist.includes(member.id)) {
      await member.ban({
        reason: "Usuário incluído na blacklist do Zenith"
      }).catch(error => {
        console.error("[BLACKLIST BAN ERROR]", error);
      });

      await sendLog(
        guild,
        "⛔ Entrada bloqueada",
        `O usuário ${member.user.tag} está na blacklist.`
      );

      return;
    }

    // Proteção contra entrada de bots
    if (member.user.bot && cfg.botProtection.enabled) {
      const isWhitelisted = cfg.whitelist.includes(member.id);

      if (!isWhitelisted) {
        await member.ban({
          reason: "Proteção contra bots ativada no Zenith"
        }).catch(error => {
          console.error("[BOT PROTECTION ERROR]", error);
        });

        await sendLog(
          guild,
          "🤖 Bot bloqueado",
          `O bot ${member.user.tag} foi bloqueado pela proteção automática.`,
          0xED4245
        );

        return;
      }
    }

    // Proteção contra raid
    if (cfg.antiraid.enabled) {
      const joins = registerJoinForRaid(guild.id);

      if (joins >= 8) {
        await sendLog(
          guild,
          "🚨 Possível raid detectada",
          `Foram detectadas ${joins} entradas em 10 segundos.\n` +
          "Verifique o servidor e considere ativar o lockdown.",
          0xED4245
        );
      }
    }

    // Boas-vindas para membros humanos
    if (!member.user.bot) {
      await sendWelcome(member);
    }
  } catch (error) {
    console.error("[GUILD MEMBER ADD ERROR]", error);
  }
});

/* ---------- REGISTRO DE MENSAGENS PARA ANTISPAM ---------- */

client.on("messageCreate", async message => {
  try {
    if (!message.guild || message.author.bot) return;

    const cfg = guildConfig(message.guild);

    if (!cfg.antispam.enabled) return;

    // Administradores não são afetados pelo antispam
    if (
      message.member?.permissions.has(
        PermissionFlagsBits.Administrator
      )
    ) {
      return;
    }

    const count = registerMessageForSpam(message);

    // 10 mensagens em 5 segundos
    if (count >= 10) {
      const member = message.member;

      if (!member || !member.moderatable) return;

      await member.timeout(
        60_000,
        "Antispam automático do Zenith"
      ).catch(error => {
        console.error("[ANTISPAM TIMEOUT ERROR]", error);
      });

      await message.channel.send({
        embeds: [
          createBasicEmbed(
            "🛡️ Antispam ativado",
            `${member} recebeu uma restrição temporária por enviar mensagens em excesso.`,
            0xED4245
          )
        ],
        allowedMentions: { users: [] }
      }).catch(() => null);

      await sendLog(
        message.guild,
        "🛡️ Antispam",
        `**Usuário:** ${member.user.tag}\n` +
        "**Ação:** timeout de 60 segundos\n" +
        `**Canal:** ${message.channel}`,
        0xED4245
      );

      spamTracker.delete(`${message.guild.id}:${message.author.id}`);
    }
  } catch (error) {
    console.error("[ANTISPAM ERROR]", error);
  }
});

/* ---------- LOG DE ENTRADA E SAÍDA ---------- */

client.on("guildMemberRemove", async member => {
  try {
    await sendLog(
      member.guild,
      "👋 Membro saiu",
      `**Usuário:** ${member.user.tag}\n**ID:** ${member.id}`,
      0xFEE75C
    );
  } catch (error) {
    console.error("[MEMBER REMOVE ERROR]", error);
  }
});

/* ---------- LOG DE MENSAGENS EDITADAS ---------- */

client.on("messageUpdate", async (oldMessage, newMessage) => {
  try {
    if (!newMessage.guild || newMessage.author?.bot) return;

    if (oldMessage.partial || newMessage.partial) return;

    const oldContent = oldMessage.content || "(sem conteúdo)";
    const newContent = newMessage.content || "(sem conteúdo)";

    if (oldContent === newContent) return;

    await sendLog(
      newMessage.guild,
      "✏️ Mensagem editada",
      `**Autor:** ${newMessage.author}\n` +
      `**Canal:** ${newMessage.channel}\n` +
      `**Antes:** ${oldContent.slice(0, 800)}\n` +
      `**Depois:** ${newContent.slice(0, 800)}`
    );
  } catch (error) {
    console.error("[MESSAGE UPDATE ERROR]", error);
  }
});

/* ---------- LOG DE MENSAGENS EXCLUÍDAS ---------- */

client.on("messageDelete", async message => {
  try {
    if (!message.guild || message.author?.bot) return;

    await sendLog(
      message.guild,
      "🗑️ Mensagem excluída",
      `**Autor:** ${message.author || "Desconhecido"}\n` +
      `**Canal:** ${message.channel}\n` +
      `**Conteúdo:** ${(message.content || "Indisponível").slice(0, 1000)}`,
      0xED4245
    );
  } catch (error) {
    console.error("[MESSAGE DELETE ERROR]", error);
  }
});

/* ---------- ATUALIZAR INFORMAÇÕES DOS SERVIDORES ---------- */

client.on("guildCreate", async guild => {
  try {
    guildConfig(guild);

    console.log(`[GUILD] Adicionado ao servidor: ${guild.name}`);

    await guild.commands.set(commands);

    console.log(`[COMMANDS] Comandos registrados em ${guild.name}`);
  } catch (error) {
    console.error("[GUILD CREATE ERROR]", error);
  }
});

client.on("guildDelete", guild => {
  console.log(`[GUILD] Removido do servidor: ${guild.name}`);
});

/* ---------- INICIALIZAÇÃO ---------- */

client.once("ready", async () => {
  console.log("==================================");
  console.log("          ZENITH ONLINE");
  console.log("==================================");
  console.log(`🤖 Bot: ${client.user.tag}`);
  console.log(`🆔 ID: ${client.user.id}`);
  console.log(`🏠 Servidores: ${client.guilds.cache.size}`);
  console.log(`📡 Ping: ${client.ws.ping} ms`);

  // Registrar comandos nos servidores disponíveis
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.commands.set(commands);
      console.log(`[COMMANDS] Comandos registrados: ${guild.name}`);
    } catch (error) {
      console.error(
        `[COMMANDS ERROR] Falha em ${guild.name}:`,
        error.message
      );
    }
  }

  console.log("[ZENITH] Inicialização concluída.");
});

/* ---------- SERVIDOR DE HEALTH CHECK ---------- */

const PORT = Number(process.env.PORT) || 3000;

const healthServer = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8"
    });

    res.end(JSON.stringify({
      status: "online",
      bot: client.isReady() ? client.user.tag : "iniciando",
      uptime: Math.floor(process.uptime())
    }));

    return;
  }

  res.writeHead(404, {
    "Content-Type": "application/json; charset=utf-8"
  });

  res.end(JSON.stringify({
    error: "Not Found"
  }));
});

healthServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[WEB] Health check ativo na porta ${PORT}`);
});

/* ---------- LOGIN ---------- */

client.login(TOKEN).catch(error => {
  console.error("[LOGIN ERROR] Não foi possível iniciar o Zenith:", error);
  process.exitCode = 1;
});

/* ---------- FIM DA PARTE 5/5 ---------- */
