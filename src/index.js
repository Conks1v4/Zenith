
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const http = require("http");

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  AuditLogEvent,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const commands = require("./commands");
const { updateServerInfo } = require("./events/updateInfo");

// ======================================================
// ZENITH — CONFIGURAÇÃO PRINCIPAL
// ======================================================

const PREFIX = process.env.PREFIX || "z!";
const PORT = Number(process.env.PORT) || 3000;
const TOKEN = process.env.DISCORD_TOKEN || process.env.TOKEN;

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "database.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(
        DB_FILE,
        JSON.stringify({ guilds: {} }, null, 2),
        "utf8"
      );
    }

    const parsed = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));

    if (!parsed || typeof parsed !== "object") {
      return { guilds: {} };
    }

    if (!parsed.guilds || typeof parsed.guilds !== "object") {
      parsed.guilds = {};
    }

    return parsed;
  } catch (error) {
    console.error("[DATABASE] Erro ao carregar banco:", error);
    return { guilds: {} };
  }
}

let db = loadDB();
let saveTimeout = null;

function saveDB() {
  if (saveTimeout) clearTimeout(saveTimeout);

  saveTimeout = setTimeout(() => {
    try {
      const temporaryFile = `${DB_FILE}.tmp`;

      fs.writeFileSync(
        temporaryFile,
        JSON.stringify(db, null, 2),
        "utf8"
      );

      fs.renameSync(temporaryFile, DB_FILE);
    } catch (error) {
      console.error("[DATABASE] Erro ao salvar banco:", error);
    }

    saveTimeout = null;
  }, 150);

  if (typeof saveTimeout.unref === "function") {
    saveTimeout.unref();
  }
}

function guildConfig(guildId) {
  if (!db.guilds[guildId]) {
    db.guilds[guildId] = {};
  }

  const config = db.guilds[guildId];

  const defaults = {
    blacklist: [],
    whitelist: [],
    feedbacks: [],
    warns: {},
    zenithOwner: null,
    logs: null,
    feedbackChannel: null,
    ticketCategory: null,
    ticketPanelChannel: null,
    ticketSupportRole: null,
    antiraid: true,
    antispam: true,
    botProtection: true,
    lockdown: false,
    ticketPanel: {
      title: "🎫 Central de Atendimento",
      description: "Selecione abaixo o tipo de atendimento desejado.",
      color: "#5865F2",
      footer: "Zenith • Atendimento",
      image: null,
      thumbnail: null
    }
  };

  for (const [key, value] of Object.entries(defaults)) {
    if (config[key] === undefined || config[key] === null) {
      config[key] = Array.isArray(value)
        ? []
        : value && typeof value === "object"
          ? { ...value }
          : value;
    }
  }

  if (!Array.isArray(config.blacklist)) config.blacklist = [];
  if (!Array.isArray(config.whitelist)) config.whitelist = [];
  if (!Array.isArray(config.feedbacks)) config.feedbacks = [];

  if (!config.warns || typeof config.warns !== "object") {
    config.warns = {};
  }

  config.ticketPanel = {
    ...defaults.ticketPanel,
    ...(config.ticketPanel || {})
  };

  return config;
}

// ======================================================
// CLIENT DISCORD
// ======================================================

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
    Partials.Message,
    Partials.GuildMember
  ]
});

client.commands = new Map();

if (Array.isArray(commands)) {
  for (const command of commands) {
    if (command && command.data && command.execute) {
      client.commands.set(command.data.name, command);
    }
  }
} else if (commands && typeof commands === "object") {
  const commandList = Array.isArray(commands.commands)
    ? commands.commands
    : Object.values(commands);

  for (const command of commandList) {
    if (command && command.data && command.execute) {
      client.commands.set(command.data.name, command);
    }
  }
}

// ======================================================
// PERMISSÕES E PROTEÇÃO
// ======================================================

function isZenithOwner(interactionOrGuild, userId) {
  const guild = interactionOrGuild?.guild || interactionOrGuild;
  const id = userId || interactionOrGuild?.user?.id;

  if (!guild || !id) return false;

  const config = guildConfig(guild.id);

  if (config.zenithOwner && config.zenithOwner === id) {
    return true;
  }

  if (guild.ownerId === id) return true;

  const member = interactionOrGuild?.member;

  if (
    member &&
    member.permissions &&
    member.permissions.has(PermissionFlagsBits.Administrator)
  ) {
    return true;
  }

  return false;
}

function isProtected(guild, userId) {
  if (!guild || !userId) return true;

  const config = guildConfig(guild.id);

  if (guild.ownerId === userId) return true;
  if (config.zenithOwner === userId) return true;

  if (
    config.whitelist.some(
      entry => String(entry) === String(userId) ||
        String(entry?.id) === String(userId)
    )
  ) {
    return true;
  }

  const member = guild.members.cache.get(userId);

  if (
    member &&
    member.permissions.has(PermissionFlagsBits.Administrator)
  ) {
    return true;
  }

  return false;
}

// ======================================================
// LOGS
// ======================================================

async function sendLog(guild, title, description, color = "#5865F2") {
  try {
    if (!guild) return;

    const config = guildConfig(guild.id);
    if (!config.logs) return;

    const channel =
      guild.channels.cache.get(config.logs) ||
      await guild.channels.fetch(config.logs).catch(() => null);

    if (!channel || !channel.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(String(title).slice(0, 256))
      .setDescription(String(description).slice(0, 4000))
      .setTimestamp()
      .setFooter({ text: "Zenith • Sistema de Logs" });

    await channel.send({ embeds: [embed] }).catch(error => {
      console.error("[LOGS] Não foi possível enviar log:", error.message);
    });
  } catch (error) {
    console.error("[LOGS] Erro:", error);
  }
}

// ======================================================
// PUNIÇÃO DE USUÁRIOS MALICIOSOS
// ======================================================

async function punish(guild, userId, reason = "Atividade suspeita") {
  try {
    if (!guild || !userId) return false;
    if (isProtected(guild, userId)) return false;

    const config = guildConfig(guild.id);

    if (
      !config.blacklist.some(
        entry => String(entry) === String(userId) ||
          String(entry?.id) === String(userId)
      )
    ) {
      config.blacklist.push({
        id: userId,
        reason,
        at: Date.now()
      });

      saveDB();
    }

    const member = await guild.members.fetch(userId).catch(() => null);

    if (member && member.bannable) {
      await member.ban({ reason: `Zenith Protection: ${reason}` });
    }

    await sendLog(
      guild,
      "🛡️ Ameaça bloqueada",
      `**Usuário:** <@${userId}> (\`${userId}\`)\n` +
      `**Motivo:** ${reason}\n` +
      `**Ação:** usuário adicionado à blacklist.`,
      "#ED4245"
    );

    return true;
  } catch (error) {
    console.error("[PROTECTION] Erro ao punir usuário:", error);
    return false;
  }
}

// ======================================================
// RESPOSTAS SEGURAS PARA INTERAÇÕES
// ======================================================

async function safeReply(interaction, payload) {
  try {
    if (interaction.deferred) {
      return await interaction.editReply(payload);
    }

    if (interaction.replied) {
      return await interaction.followUp(payload);
    }

    return await interaction.reply(payload);
  } catch (error) {
    if (error.code !== 10062 && error.code !== 40060) {
      console.error("[INTERACTION] Erro ao responder:", error);
    }

    return null;
  }
}

function isTicketChannel(channel) {
  return Boolean(
    channel &&
    channel.type === ChannelType.GuildText &&
    typeof channel.topic === "string" &&
    channel.topic.startsWith("ZENITH_TICKET:")
  );
}

function getTicketOwner(channel) {
  if (!isTicketChannel(channel)) return null;

  return channel.topic.slice("ZENITH_TICKET:".length) || null;
}

 
// ======================================================
// ANTI-SPAM
// ======================================================

const spamTracker = new Map();
const SPAM_WINDOW_MS = 5000;
const SPAM_MAX_MESSAGES = 10;
const SPAM_TIMEOUT_MS = 60_000;

client.on("messageCreate", async message => {
  try {
    if (!message.guild || message.author.bot) return;

    const config = guildConfig(message.guild.id);
    if (!config.antispam) return;

    if (isProtected(message.guild, message.author.id)) return;

    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();

    let record = spamTracker.get(key);

    if (!record || now - record.startedAt > SPAM_WINDOW_MS) {
      record = {
        startedAt: now,
        messages: []
      };
    }

    record.messages.push({
      id: message.id,
      timestamp: now
    });

    record.messages = record.messages.filter(
      item => now - item.timestamp <= SPAM_WINDOW_MS
    );

    spamTracker.set(key, record);

    if (record.messages.length < SPAM_MAX_MESSAGES) return;

    spamTracker.delete(key);

    const member = await message.guild.members
      .fetch(message.author.id)
      .catch(() => null);

    if (!member || !member.moderatable) return;

    await member.timeout(
      SPAM_TIMEOUT_MS,
      "Zenith Anti-Spam: excesso de mensagens"
    );

    await sendLog(
      message.guild,
      "🚨 Anti-Spam acionado",
      `**Usuário:** ${message.author.tag} (\`${message.author.id}\`)\n` +
      `**Canal:** ${message.channel}\n` +
      `**Mensagens:** ${SPAM_MAX_MESSAGES} em ${SPAM_WINDOW_MS / 1000}s\n` +
      `**Punição:** timeout de 60 segundos.`,
      "#ED4245"
    );

    await message.channel.send({
      content: `⚠️ ${message.author}, você foi temporariamente silenciado por spam.`
    }).then(msg => {
      setTimeout(() => {
        msg.delete().catch(() => {});
      }, 5000);
    }).catch(() => {});

  } catch (error) {
    console.error("[ANTI-SPAM] Erro:", error);
  }
});

// ======================================================
// LIMPEZA DOS REGISTROS ANTISPAM
// ======================================================

setInterval(() => {
  const now = Date.now();

  for (const [key, record] of spamTracker.entries()) {
    if (now - record.startedAt > SPAM_WINDOW_MS * 3) {
      spamTracker.delete(key);
    }
  }
}, 30_000).unref();

// ======================================================
// ANTI-RAID
// ======================================================

const raidTracker = new Map();
const RAID_WINDOW_MS = 10_000;
const RAID_MAX_ACTIONS = 3;

const monitoredAuditEvents = [
  AuditLogEvent.ChannelCreate,
  AuditLogEvent.ChannelDelete,
  AuditLogEvent.ChannelUpdate,
  AuditLogEvent.RoleCreate,
  AuditLogEvent.RoleDelete,
  AuditLogEvent.RoleUpdate
];

client.on("guildAuditLogEntryCreate", async (entry, guild) => {
  try {
    const config = guildConfig(guild.id);
    if (!config.antiraid) return;

    if (!monitoredAuditEvents.includes(entry.action)) return;
    if (!entry.executorId) return;

    // Ignora ações realizadas pelo próprio bot.
    if (entry.executorId === client.user?.id) return;

    if (isProtected(guild, entry.executorId)) return;

    const key = `${guild.id}:${entry.executorId}`;
    const now = Date.now();

    let record = raidTracker.get(key);

    if (!record || now - record.startedAt > RAID_WINDOW_MS) {
      record = {
        startedAt: now,
        actions: []
      };
    }

    record.actions.push({
      action: entry.action,
      timestamp: now
    });

    record.actions = record.actions.filter(
      item => now - item.timestamp <= RAID_WINDOW_MS
    );

    raidTracker.set(key, record);

    if (record.actions.length < RAID_MAX_ACTIONS) return;

    raidTracker.delete(key);

    await punish(
      guild,
      entry.executorId,
      "Anti-Raid: múltiplas alterações suspeitas em pouco tempo"
    );

  } catch (error) {
    console.error("[ANTI-RAID] Erro:", error);
  }
});

// ======================================================
// LIMPEZA DOS REGISTROS ANTI-RAID
// ======================================================

setInterval(() => {
  const now = Date.now();

  for (const [key, record] of raidTracker.entries()) {
    if (now - record.startedAt > RAID_WINDOW_MS * 3) {
      raidTracker.delete(key);
    }
  }
}, 30_000).unref();

// ======================================================
// ANTI-BOT
// ======================================================

client.on("guildMemberAdd", async member => {
  try {
    if (!member.user.bot) return;

    const config = guildConfig(member.guild.id);
    if (!config.botProtection) return;

    let auditEntry = null;

    try {
      const audit = await member.guild.fetchAuditLogs({
        type: AuditLogEvent.BotAdd,
        limit: 5
      });

      auditEntry = audit.entries.find(entry => {
        if (!entry.target) return false;

        const targetId =
          entry.target.id ||
          entry.targetId;

        return (
          targetId === member.id &&
          Date.now() - entry.createdTimestamp < 15_000
        );
      });
    } catch (error) {
      console.error("[ANTI-BOT] Não foi possível consultar auditoria:", error);
    }

    const executorId = auditEntry?.executorId;

    // Sem identificar quem adicionou o bot, não pune usuários aleatoriamente.
    if (!executorId) {
      await sendLog(
        member.guild,
        "🤖 Novo bot detectado",
        `**Bot:** ${member.user.tag} (\`${member.id}\`)\n` +
        "Não foi possível identificar quem adicionou o bot. Nenhuma punição automática foi aplicada.",
        "#FEE75C"
      );

      return;
    }

    if (executorId === client.user?.id) return;
    if (isProtected(member.guild, executorId)) return;

    const executor = await member.guild.members
      .fetch(executorId)
      .catch(() => null);

    if (!executor) return;

    await punish(
      member.guild,
      executorId,
      "Anti-Bot: adição de bot por usuário não autorizado"
    );

    // Tenta remover o bot recém-adicionado.
    if (member.bannable) {
      await member.ban({
        reason: "Zenith Anti-Bot: bot adicionado por usuário não autorizado"
      }).catch(error => {
        console.error("[ANTI-BOT] Não foi possível banir o bot:", error);
      });
    }

  } catch (error) {
    console.error("[ANTI-BOT] Erro:", error);
  }
});

// ======================================================
// EVENTO DE ENTRADA DE MEMBROS — LOG
// ======================================================

client.on("guildMemberAdd", async member => {
  try {
    await sendLog(
      member.guild,
      "📥 Membro entrou",
      `**Usuário:** ${member.user.tag}\n` +
      `**ID:** \`${member.id}\`\n` +
      `**Membros no servidor:** ${member.guild.memberCount}`,
      "#57F287"
    );
  } catch (error) {
    console.error("[MEMBER-ADD] Erro:", error);
  }
});

// ======================================================
// EVENTO DE SAÍDA DE MEMBROS — LOG
// ======================================================

client.on("guildMemberRemove", async member => {
  try {
    await sendLog(
      member.guild,
      "📤 Membro saiu",
      `**Usuário:** ${member.user.tag || member.id}\n` +
      `**ID:** \`${member.id}\`\n` +
      `**Membros restantes:** ${member.guild.memberCount}`,
      "#ED4245"
    );
  } catch (error) {
    console.error("[MEMBER-REMOVE] Erro:", error);
  }
});

 
// ======================================================
// ZENITH — SISTEMA DE TICKETS
// PARTE 3/6
// ======================================================

const TICKET_TYPES = {
  suporte: {
    label: "Suporte",
    emoji: "🛠️",
    description: "Preciso de ajuda com alguma coisa."
  },
  denuncia: {
    label: "Denúncia",
    emoji: "🚨",
    description: "Quero realizar uma denúncia."
  },
  duvida: {
    label: "Dúvida",
    emoji: "❓",
    description: "Tenho uma dúvida."
  },
  compra: {
    label: "Compras",
    emoji: "🛒",
    description: "Preciso de ajuda com uma compra."
  }
};

function createTicketPanelEmbed(guild) {
  const config = guildConfig(guild.id);
  const panel = config.ticketPanel;

  const embed = new EmbedBuilder()
    .setColor(panel.color || "#5865F2")
    .setTitle(panel.title || "🎫 Central de Atendimento")
    .setDescription(
      panel.description ||
      "Selecione abaixo o tipo de atendimento desejado."
    )
    .setFooter({
      text: panel.footer || "Zenith • Atendimento"
    })
    .setTimestamp();

  if (panel.image) embed.setImage(panel.image);
  if (panel.thumbnail) embed.setThumbnail(panel.thumbnail);

  return embed;
}

function createTicketPanelComponents() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("zenith_ticket_type")
    .setPlaceholder("Selecione o tipo de atendimento")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      Object.entries(TICKET_TYPES).map(([value, type]) => ({
        label: type.label,
        value,
        emoji: type.emoji,
        description: type.description
      }))
    );

  return [
    new ActionRowBuilder().addComponents(menu)
  ];
}

async function sendTicketPanel(channel) {
  if (!channel || !channel.isTextBased()) {
    throw new Error("O canal do painel não é um canal de texto válido.");
  }

  if (!channel.guild) {
    throw new Error("Não foi possível identificar o servidor.");
  }

  const message = await channel.send({
    embeds: [createTicketPanelEmbed(channel.guild)],
    components: createTicketPanelComponents()
  });

  const config = guildConfig(channel.guild.id);
  config.ticketPanelChannel = channel.id;
  saveDB();

  return message;
}

// ======================================================
// LOCALIZAR TICKET EXISTENTE
// ======================================================

function findOpenTicket(guild, userId) {
  return guild.channels.cache.find(channel => {
    return (
      isTicketChannel(channel) &&
      getTicketOwner(channel) === userId
    );
  }) || null;
}

// ======================================================
// PERMISSÕES DO TICKET
// ======================================================

function buildTicketPermissions(guild, userId) {
  const config = guildConfig(guild.id);

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: userId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    }
  ];

  if (client.user) {
    overwrites.push({
      id: client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages
      ]
    });
  }

  if (config.ticketSupportRole) {
    const role = guild.roles.cache.get(config.ticketSupportRole);

    if (role) {
      overwrites.push({
        id: role.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks
        ]
      });
    }
  }

  return overwrites;
}

// ======================================================
// BOTÕES DO CANAL DE TICKET
// ======================================================

function createTicketActionRows(channelId) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("zenith_close_ticket")
      .setLabel("Fechar ticket")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId("zenith_claim_ticket")
      .setLabel("Assumir")
      .setEmoji("🙋")
      .setStyle(ButtonStyle.Primary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("zenith_add_ticket_member")
      .setLabel("Adicionar membro")
      .setEmoji("➕")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("zenith_remove_ticket_member")
      .setLabel("Remover membro")
      .setEmoji("➖")
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2];
}

// ======================================================
// CRIAR TICKET
// ======================================================

async function createTicket(interaction, ticketType) {
  let responseDeferred = false;

  try {
    await interaction.deferReply({ ephemeral: true });
    responseDeferred = true;

    const guild = interaction.guild;
    const user = interaction.user;

    if (!guild) {
      return interaction.editReply({
        content: "❌ Este sistema só funciona dentro de um servidor."
      });
    }

    const type = TICKET_TYPES[ticketType];

    if (!type) {
      return interaction.editReply({
        content: "❌ Tipo de ticket inválido."
      });
    }

    const existing = findOpenTicket(guild, user.id);

    if (existing) {
      return interaction.editReply({
        content: `⚠️ Você já possui um ticket aberto: ${existing}`
      });
    }

    const config = guildConfig(guild.id);

    let category = null;

    if (config.ticketCategory) {
      category =
        guild.channels.cache.get(config.ticketCategory) ||
        await guild.channels.fetch(config.ticketCategory).catch(() => null);
    }

    if (category && category.type !== ChannelType.GuildCategory) {
      category = null;
    }

    const channelName =
      `ticket-${type.label.toLowerCase()}-${user.username}`
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 90);

    const channel = await guild.channels.create({
      name: channelName || `ticket-${user.id}`,
      type: ChannelType.GuildText,
      topic: `ZENITH_TICKET:${user.id}`,
      parent: category?.id || undefined,
      permissionOverwrites: buildTicketPermissions(guild, user.id),
      reason: `Ticket ${type.label} aberto por ${user.tag}`
    });

    const embed = new EmbedBuilder()
      .setColor(config.ticketPanel.color || "#5865F2")
      .setTitle(`${type.emoji} ${type.label}`)
      .setDescription(
        `Olá ${user}, seu atendimento foi criado.\n\n` +
        `**Tipo:** ${type.label}\n` +
        `**Responsável:** Aguardando atendimento\n\n` +
        "Descreva seu problema ou sua solicitação com o máximo de detalhes possível.\n\n" +
        "Nossa equipe responderá assim que possível."
      )
      .addFields(
        {
          name: "👤 Solicitante",
          value: `${user.tag}\n\`${user.id}\``,
          inline: true
        },
        {
          name: "📌 Status",
          value: "Aguardando atendimento",
          inline: true
        }
      )
      .setFooter({
        text: config.ticketPanel.footer || "Zenith • Atendimento"
      })
      .setTimestamp();

    await channel.send({
      content: `${user}`,
      embeds: [embed],
      components: createTicketActionRows(channel.id)
    });

    await sendLog(
      guild,
      "🎫 Ticket criado",
      `**Canal:** ${channel}\n` +
      `**Solicitante:** ${user.tag} (\`${user.id}\`)\n` +
      `**Tipo:** ${type.label}`,
      "#57F287"
    );

    return interaction.editReply({
      content: `✅ Seu ticket foi criado: ${channel}`
    });

  } catch (error) {
    console.error("[TICKETS] Erro ao criar ticket:", error);

    if (responseDeferred) {
      return interaction.editReply({
        content: "❌ Não foi possível criar seu ticket. Verifique as permissões do bot e tente novamente."
      }).catch(() => null);
    }

    return safeReply(interaction, {
      content: "❌ Ocorreu um erro ao criar o ticket.",
      ephemeral: true
    });
  }
}

// ======================================================
// IDENTIFICAR RESPONSÁVEIS PELO ATENDIMENTO
// ======================================================

function canManageTicket(interaction) {
  const member = interaction.member;

  if (!member || !interaction.guild) return false;

  if (isZenithOwner(interaction)) return true;

  const config = guildConfig(interaction.guild.id);

  if (
    config.ticketSupportRole &&
    member.roles?.cache?.has(config.ticketSupportRole)
  ) {
    return true;
  }

  return Boolean(
    member.permissions?.has(PermissionFlagsBits.Administrator)
  );
}

// ======================================================
// ASSUMIR TICKET
// ======================================================

async function claimTicket(interaction) {
  const channel = interaction.channel;

  if (!isTicketChannel(channel)) {
    return safeReply(interaction, {
      content: "❌ Este canal não é um ticket do Zenith.",
      ephemeral: true
    });
  }

  if (!canManageTicket(interaction)) {
    return safeReply(interaction, {
      content: "❌ Você não tem permissão para assumir tickets.",
      ephemeral: true
    });
  }

  const messages = await channel.messages.fetch({ limit: 30 });

  const ticketMessage = messages.find(message =>
    message.author.id === client.user.id &&
    message.embeds.some(embed =>
      embed.fields?.some(field => field.name === "📌 Status")
    )
  );

  if (!ticketMessage) {
    return safeReply(interaction, {
      content: "❌ Não encontrei a mensagem principal do ticket.",
      ephemeral: true
    });
  }

  const oldEmbed = ticketMessage.embeds[0];
  const embed = EmbedBuilder.from(oldEmbed);

  embed.spliceFields(
    1,
    1,
    {
      name: "📌 Status",
      value: `Assumido por ${interaction.user}`,
      inline: true
    }
  );

  await ticketMessage.edit({ embeds: [embed] });

  await safeReply(interaction, {
    content: `✅ Você assumiu o atendimento em ${channel}.`,
    ephemeral: true
  });

  await sendLog(
    interaction.guild,
    "🙋 Ticket assumido",
    `**Canal:** ${channel}\n**Responsável:** ${interaction.user}`,
    "#5865F2"
  );
}

// ======================================================
// SELETORES PARA ADICIONAR E REMOVER MEMBROS
// ======================================================

function createTicketUserSelect(action) {
  const menu = new UserSelectMenuBuilder()
    .setCustomId(
      action === "add"
        ? "zenith_ticket_add_user_select"
        : "zenith_ticket_remove_user_select"
    )
    .setPlaceholder(
      action === "add"
        ? "Escolha quem poderá ver o ticket"
        : "Escolha quem perderá acesso ao ticket"
    )
    .setMinValues(1)
    .setMaxValues(1);

  return new ActionRowBuilder().addComponents(menu);
}

// ======================================================
// ABRIR SELETOR DE MEMBROS
// ======================================================

async function openTicketMemberSelector(interaction, action) {
  if (!isTicketChannel(interaction.channel)) {
    return safeReply(interaction, {
      content: "❌ Este canal não é um ticket do Zenith.",
      ephemeral: true
    });
  }

  if (!canManageTicket(interaction)) {
    return safeReply(interaction, {
      content: "❌ Somente a equipe autorizada pode gerenciar os membros do ticket.",
      ephemeral: true
    });
  }

  return safeReply(interaction, {
    content:
      action === "add"
        ? "Selecione o membro que deseja adicionar ao ticket."
        : "Selecione o membro que deseja remover do ticket.",
    components: [createTicketUserSelect(action)],
    ephemeral: true
  });
}

// ======================================================
// PROCESSAR SELEÇÃO DE MEMBRO
// ======================================================

async function processTicketMemberSelect(interaction, action) {
  try {
    const channel = interaction.channel;
    const guild = interaction.guild;

    if (!isTicketChannel(channel) || !guild) {
      return safeReply(interaction, {
        content: "❌ Ticket inválido.",
        ephemeral: true
      });
    }

    if (!canManageTicket(interaction)) {
      return safeReply(interaction, {
        content: "❌ Você não tem permissão para alterar os membros.",
        ephemeral: true
      });
    }

    const userId = interaction.values?.[0];

    if (!userId) {
      return safeReply(interaction, {
        content: "❌ Nenhum membro foi selecionado.",
        ephemeral: true
      });
    }

    const ownerId = getTicketOwner(channel);

    if (userId === guild.ownerId) {
      return safeReply(interaction, {
        content: "❌ Não é possível remover o proprietário do servidor.",
        ephemeral: true
      });
    }

    if (action === "remove" && userId === ownerId) {
      return safeReply(interaction, {
        content: "❌ Não é possível remover o solicitante original do próprio ticket.",
        ephemeral: true
      });
    }

    const member = await guild.members.fetch(userId).catch(() => null);

    if (!member) {
      return safeReply(interaction, {
        content: "❌ Esse usuário não está mais no servidor.",
        ephemeral: true
      });
    }

    if (action === "add") {
      await channel.permissionOverwrites.edit(member.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true,
        EmbedLinks: true
      });

      await safeReply(interaction, {
        content: `✅ ${member.user.tag} agora tem acesso a ${channel}.`,
        ephemeral: true
      });

      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor("#57F287")
            .setDescription(
              `➕ ${member} foi adicionado ao ticket por ${interaction.user}.`
            )
            .setTimestamp()
        ]
      });

    } else {
      await channel.permissionOverwrites.delete(member.id).catch(async () => {
        await channel.permissionOverwrites.edit(member.id, {
          ViewChannel: false,
          SendMessages: false,
          ReadMessageHistory: false
        });
      });

      await safeReply(interaction, {
        content: `✅ O acesso de ${member.user.tag} ao ticket foi removido.`,
        ephemeral: true
      });

      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor("#ED4245")
            .setDescription(
              `➖ O acesso de ${member.user.tag} foi removido por ${interaction.user}.`
            )
            .setTimestamp()
        ]
      });
    }

  } catch (error) {
    console.error("[TICKETS] Erro ao gerenciar membros:", error);

    await safeReply(interaction, {
      content: "❌ Não foi possível alterar as permissões do membro.",
      ephemeral: true
    });
  }
}

 
// ======================================================
// ZENITH — FECHAMENTO DE TICKETS
// PARTE 4/6
// ======================================================

// Impede dois fechamentos simultâneos no mesmo canal.
const ticketsClosing = new Set();

// ======================================================
// GERAR TRANSCRIÇÃO DO TICKET
// ======================================================

async function generateTicketTranscript(channel) {
  const allMessages = [];
  let lastId;

  try {
    while (true) {
      const options = { limit: 100 };

      if (lastId) {
        options.before = lastId;
      }

      const batch = await channel.messages.fetch(options);

      if (batch.size === 0) break;

      allMessages.push(...batch.values());
      lastId = batch.last().id;

      if (batch.size < 100) break;

      // Limite de segurança para evitar transcrições enormes.
      if (allMessages.length >= 2000) break;
    }

    allMessages.sort(
      (a, b) => a.createdTimestamp - b.createdTimestamp
    );

    const lines = [
      `Transcrição do ticket: ${channel.name}`,
      `Servidor: ${channel.guild.name}`,
      `ID do canal: ${channel.id}`,
      `Gerado em: ${new Date().toISOString()}`,
      "=".repeat(80),
      ""
    ];

    for (const message of allMessages) {
      const timestamp = new Date(message.createdTimestamp).toLocaleString(
        "pt-BR",
        { timeZone: "UTC" }
      );

      const author = message.author
        ? `${message.author.tag} (${message.author.id})`
        : "Autor desconhecido";

      lines.push(`[${timestamp}] ${author}`);

      if (message.content) {
        lines.push(message.content);
      }

      for (const attachment of message.attachments.values()) {
        lines.push(`Anexo: ${attachment.url}`);
      }

      for (const embed of message.embeds) {
        if (embed.title) lines.push(`Título: ${embed.title}`);
        if (embed.description) {
          lines.push(`Descrição: ${embed.description}`);
        }
      }

      if (message.stickers.size) {
        lines.push(
          `Figurinhas: ${message.stickers.map(sticker => sticker.name).join(", ")}`
        );
      }

      lines.push("");
    }

    return lines.join("\n");

  } catch (error) {
    console.error("[TICKETS] Erro ao gerar transcrição:", error);

    return [
      `Transcrição parcial: ${channel.name}`,
      `Servidor: ${channel.guild.name}`,
      `Canal: ${channel.id}`,
      "Não foi possível recuperar todas as mensagens."
    ].join("\n");
  }
}

// ======================================================
// CRIAR BOTÕES DE AVALIAÇÃO
// ======================================================

function createFeedbackButtons(guildId, ticketId) {
  const row = new ActionRowBuilder();

  for (let rating = 1; rating <= 5; rating++) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(
          `feedback:${guildId}:${ticketId}:${rating}`
        )
        .setLabel(`${rating} ⭐`)
        .setStyle(
          rating >= 4
            ? ButtonStyle.Success
            : rating >= 3
              ? ButtonStyle.Primary
              : ButtonStyle.Secondary
        )
    );
  }

  return row;
}

// ======================================================
// ENVIAR PEDIDO DE AVALIAÇÃO
// ======================================================

async function requestTicketFeedback(
  guild,
  ownerId,
  ticketId,
  ticketName,
  transcript
) {
  try {
    const config = guildConfig(guild.id);

    const owner = await client.users.fetch(ownerId).catch(() => null);

    if (owner) {
      const embed = new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle("⭐ Avalie seu atendimento")
        .setDescription(
          `Seu ticket **${ticketName}** foi encerrado.\n\n` +
          "Como foi sua experiência com o atendimento do Zenith?\n" +
          "Escolha uma nota de 1 a 5 estrelas abaixo."
        )
        .setFooter({ text: "Zenith • Avaliação de Atendimento" })
        .setTimestamp();

      await owner.send({
        embeds: [embed],
        components: [createFeedbackButtons(guild.id, ticketId)]
      }).catch(() => null);
    }

    // Envia a transcrição ao canal de logs, se configurado.
    if (config.logs) {
      const logChannel =
        guild.channels.cache.get(config.logs) ||
        await guild.channels.fetch(config.logs).catch(() => null);

      if (logChannel && logChannel.isTextBased()) {
        const attachment = Buffer.from(transcript, "utf8");

        await logChannel.send({
          embeds: [
            new EmbedBuilder()
              .setColor("#5865F2")
              .setTitle("📄 Transcrição de ticket")
              .setDescription(
                `**Ticket:** ${ticketName}\n` +
                `**Solicitante:** <@${ownerId}>\n` +
                `**ID do canal:** \`${ticketId}\``
              )
              .setTimestamp()
          ],
          files: [{
            attachment,
            name: `transcricao-${ticketId}.txt`
          }]
        }).catch(error => {
          console.error("[TICKETS] Erro ao enviar transcrição:", error);
        });
      }
    }

  } catch (error) {
    console.error("[TICKETS] Erro ao solicitar avaliação:", error);
  }
}

// ======================================================
// FECHAR TICKET
// ======================================================

async function closeTicket(interaction) {
  const channel = interaction.channel;

  if (!isTicketChannel(channel)) {
    return safeReply(interaction, {
      content: "❌ Este canal não é um ticket válido.",
      ephemeral: true
    });
  }

  if (ticketsClosing.has(channel.id)) {
    return safeReply(interaction, {
      content: "⏳ Este ticket já está sendo encerrado.",
      ephemeral: true
    });
  }

  const ownerId = getTicketOwner(channel);
  const isOwner = interaction.user.id === ownerId;
  const isStaff = canManageTicket(interaction);

  if (!isOwner && !isStaff) {
    return safeReply(interaction, {
      content: "❌ Somente o solicitante ou a equipe autorizada pode fechar este ticket.",
      ephemeral: true
    });
  }

  ticketsClosing.add(channel.id);

  try {
    await interaction.deferReply({ ephemeral: true });

    await interaction.editReply({
      content: "🔒 Encerrando ticket e preparando a transcrição..."
    });

    const transcript = await generateTicketTranscript(channel);
    const guild = channel.guild;
    const ticketName = channel.name;
    const ticketId = channel.id;

    await sendLog(
      guild,
      "🔒 Ticket encerrado",
      `**Canal:** #${ticketName}\n` +
      `**Solicitante:** <@${ownerId}>\n` +
      `**Encerrado por:** ${interaction.user.tag} (\`${interaction.user.id}\`)\n` +
      `**Transcrição:** sendo preparada.`,
      "#ED4245"
    );

    await requestTicketFeedback(
      guild,
      ownerId,
      ticketId,
      ticketName,
      transcript
    );

    await interaction.editReply({
      content: "✅ Ticket encerrado. A transcrição foi processada e a avaliação foi enviada quando possível."
    }).catch(() => null);

    // Dá tempo para os logs serem enviados antes de excluir o canal.
    await new Promise(resolve => setTimeout(resolve, 2000));

    await channel.delete(
      `Ticket encerrado por ${interaction.user.tag}`
    );

  } catch (error) {
    console.error("[TICKETS] Erro ao fechar ticket:", error);

    await safeReply(interaction, {
      content: "❌ Não foi possível concluir o fechamento. Verifique as permissões do bot.",
      ephemeral: true
    });

  } finally {
    ticketsClosing.delete(channel.id);
  }
}

// ======================================================
// REGISTRAR AVALIAÇÃO RECEBIDA
// ======================================================

async function handleTicketFeedback(interaction) {
  try {
    const parts = interaction.customId.split(":");

    if (parts.length !== 4) {
      return safeReply(interaction, {
        content: "❌ Esta avaliação é inválida.",
        ephemeral: true
      });
    }

    const [, guildId, ticketId, ratingText] = parts;
    const rating = Number(ratingText);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return safeReply(interaction, {
        content: "❌ A nota precisa estar entre 1 e 5.",
        ephemeral: true
      });
    }

    const guild = client.guilds.cache.get(guildId);

    if (!guild) {
      return safeReply(interaction, {
        content: "❌ Não consegui localizar o servidor deste atendimento.",
        ephemeral: true
      });
    }

    const config = guildConfig(guildId);

    const alreadyRated = config.feedbacks.some(item => {
      return (
        item &&
        typeof item === "object" &&
        item.ticketId === ticketId &&
        item.userId === interaction.user.id
      );
    });

    if (alreadyRated) {
      return safeReply(interaction, {
        content: "ℹ️ Você já avaliou este atendimento.",
        ephemeral: true
      });
    }

    const feedback = {
      ticketId,
      userId: interaction.user.id,
      username: interaction.user.tag,
      rating,
      createdAt: new Date().toISOString()
    };

    config.feedbacks.push(feedback);
    saveDB();

    await safeReply(interaction, {
      content: `⭐ Obrigado pela avaliação! Você deu ${rating} de 5 estrelas.`,
      ephemeral: true
    });

    // Desativa os botões depois da avaliação.
    await interaction.message.edit({
      components: []
    }).catch(() => {});

    await sendLog(
      guild,
      "⭐ Nova avaliação de atendimento",
      `**Usuário:** ${interaction.user.tag} (\`${interaction.user.id}\`)\n` +
      `**Nota:** ${"⭐".repeat(rating)} (${rating}/5)\n` +
      `**Ticket:** \`${ticketId}\``,
      rating >= 4 ? "#57F287" : rating >= 3 ? "#FEE75C" : "#ED4245"
    );

  } catch (error) {
    console.error("[FEEDBACK] Erro ao registrar avaliação:", error);

    await safeReply(interaction, {
      content: "❌ Não foi possível salvar sua avaliação.",
      ephemeral: true
    });
  }
}

// ======================================================
// RESUMO DAS AVALIAÇÕES
// ======================================================

function getFeedbackSummary(guildId) {
  const config = guildConfig(guildId);

  const feedbacks = config.feedbacks.filter(item => {
    return (
      item &&
      typeof item === "object" &&
      Number.isInteger(item.rating) &&
      item.rating >= 1 &&
      item.rating <= 5
    );
  });

  const total = feedbacks.length;

  if (total === 0) {
    return {
      total: 0,
      average: 0,
      distribution: [0, 0, 0, 0, 0]
    };
  }

  const sum = feedbacks.reduce((acc, item) => acc + item.rating, 0);

  const distribution = [1, 2, 3, 4, 5].map(rating =>
    feedbacks.filter(item => item.rating === rating).length
  );

  return {
    total,
    average: Number((sum / total).toFixed(2)),
    distribution
  };
}

function configEmbed(guild) {
  const config = guildConfig(guild.id);

  const channelText = (id) => id ? `<#${id}>` : "`Não configurado`";
  const roleText = (id) => id ? `<@&${id}>` : "`Não configurado`";
  const ownerText = config.zenithOwner
    ? `<@${config.zenithOwner}>`
    : "`Dono do Zenith não configurado`";

  return new EmbedBuilder()
    .setColor("#5865F2")
    .setTitle("⚙️・Painel de Configuração — Zenith")
    .setDescription(
      "Configure os principais sistemas do bot usando os botões abaixo.\n" +
      "As alterações são salvas automaticamente."
    )
    .addFields(
      {
        name: "👑 Responsável pelo Zenith",
        value: ownerText,
        inline: false
      },
      {
        name: "📂 Categoria dos tickets",
        value: channelText(config.ticketCategory),
        inline: true
      },
      {
        name: "📋 Canal de logs",
        value: channelText(config.logs),
        inline: true
      },
      {
        name: "⭐ Canal de feedback",
        value: channelText(config.feedbackChannel),
        inline: true
      },
      {
        name: "🎫 Canal do painel de tickets",
        value: channelText(config.ticketPanelChannel),
        inline: true
      },
      {
        name: "🛡️ Proteção do servidor",
        value:
          `Anti-raid: ${config.antiraid ? "🟢 Ativado" : "🔴 Desativado"}\n` +
          `Anti-spam: ${config.antispam ? "🟢 Ativado" : "🔴 Desativado"}\n` +
          `Proteção contra bots: ${config.botProtection ? "🟢 Ativada" : "🔴 Desativada"}`,
        inline: false
      },
      {
        name: "🎨 Personalização do painel",
        value:
          `**Título:** ${config.ticketPanel.title || "Não definido"}\n` +
          `**Cor:** ${config.ticketPanel.color || "#5865F2"}\n` +
          `**Rodapé:** ${config.ticketPanel.footer || "Não definido"}`,
        inline: false
      }
    )
    .setFooter({ text: "Zenith • Configurações do servidor" })
    .setTimestamp();
}

function configButtons() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("config_owner")
      .setLabel("Responsável")
      .setEmoji("👑")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("config_category")
      .setLabel("Categoria")
      .setEmoji("📂")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("config_logs")
      .setLabel("Logs")
      .setEmoji("📋")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("config_feedback")
      .setLabel("Feedback")
      .setEmoji("⭐")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("config_panel")
      .setLabel("Personalizar painel")
      .setEmoji("🎨")
      .setStyle(ButtonStyle.Primary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("config_security")
      .setLabel("Segurança")
      .setEmoji("🛡️")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId("config_send_panel")
      .setLabel("Publicar painel")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("config_refresh")
      .setLabel("Atualizar")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2];
}

function configSecurityEmbed(guild) {
  const config = guildConfig(guild.id);

  return new EmbedBuilder()
    .setColor("#ED4245")
    .setTitle("🛡️・Segurança do Zenith")
    .setDescription(
      "Ative ou desative os sistemas de proteção abaixo.\n\n" +
      "• **Anti-raid:** monitora alterações suspeitas em canais e cargos.\n" +
      "• **Anti-spam:** monitora mensagens repetidas em excesso.\n" +
      "• **Proteção contra bots:** monitora a entrada de bots no servidor."
    )
    .addFields({
      name: "Estado atual",
      value:
        `Anti-raid: ${config.antiraid ? "🟢 Ativado" : "🔴 Desativado"}\n` +
        `Anti-spam: ${config.antispam ? "🟢 Ativado" : "🔴 Desativado"}\n` +
        `Proteção contra bots: ${config.botProtection ? "🟢 Ativada" : "🔴 Desativada"}`
    })
    .setFooter({ text: "Zenith • Central de segurança" });
}

function configSecurityButtons(guild) {
  const config = guildConfig(guild.id);

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("config_toggle_antiraid")
        .setLabel(config.antiraid ? "Desativar anti-raid" : "Ativar anti-raid")
        .setStyle(config.antiraid ? ButtonStyle.Danger : ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("config_toggle_antispam")
        .setLabel(config.antispam ? "Desativar anti-spam" : "Ativar anti-spam")
        .setStyle(config.antispam ? ButtonStyle.Danger : ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("config_toggle_botProtection")
        .setLabel(config.botProtection ? "Desativar anti-bots" : "Ativar anti-bots")
        .setStyle(config.botProtection ? ButtonStyle.Danger : ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("config_security_back")
        .setLabel("Voltar às configurações")
        .setEmoji("⬅️")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function createConfigChannelSelect(customId, placeholder, channelType) {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setMinValues(1)
    .setMaxValues(1);

  if (channelType !== undefined) {
    menu.setChannelTypes(channelType);
  }

  return new ActionRowBuilder().addComponents(menu);
}

function createOwnerModal() {
  const input = new TextInputBuilder()
    .setCustomId("zenith_owner_id")
    .setLabel("ID do usuário responsável")
    .setPlaceholder("Digite o ID numérico do usuário")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(17)
    .setMaxLength(20);

  return new ModalBuilder()
    .setCustomId("config_owner_modal")
    .setTitle("Configurar responsável do Zenith")
    .addComponents(
      new ActionRowBuilder().addComponents(input)
    );
}

function createTicketPanelModal(guild) {
  const config = guildConfig(guild.id);
  const panel = config.ticketPanel;

  const titleInput = new TextInputBuilder()
    .setCustomId("panel_title")
    .setLabel("Título do painel")
    .setStyle(TextInputStyle.Short)
    .setValue(String(panel.title || "🎫 Central de Atendimento").slice(0, 100))
    .setMaxLength(100)
    .setRequired(true);

  const descriptionInput = new TextInputBuilder()
    .setCustomId("panel_description")
    .setLabel("Descrição do painel")
    .setStyle(TextInputStyle.Paragraph)
    .setValue(String(panel.description || "Selecione abaixo o tipo de atendimento desejado.").slice(0, 1000))
    .setMaxLength(1000)
    .setRequired(true);

  const colorInput = new TextInputBuilder()
    .setCustomId("panel_color")
    .setLabel("Cor hexadecimal (ex.: #5865F2)")
    .setStyle(TextInputStyle.Short)
    .setValue(String(panel.color || "#5865F2").slice(0, 7))
    .setMaxLength(7)
    .setRequired(true);

  const footerInput = new TextInputBuilder()
    .setCustomId("panel_footer")
    .setLabel("Texto do rodapé")
    .setStyle(TextInputStyle.Short)
    .setValue(String(panel.footer || "Zenith • Atendimento").slice(0, 100))
    .setMaxLength(100)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId("config_panel_modal")
    .setTitle("Personalizar painel de tickets")
    .addComponents(
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(descriptionInput),
      new ActionRowBuilder().addComponents(colorInput),
      new ActionRowBuilder().addComponents(footerInput)
    );
}

function canConfigure(interaction) {
  if (!interaction.guild || !interaction.member) return false;

  return isZenithOwner(interaction) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

client.on("interactionCreate", async (interaction) => {
  try {
    // Comandos slash
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);

      if (!command) {
        return safeReply(interaction, {
          content: "❌ Esse comando não foi encontrado.",
          ephemeral: true
        });
      }

      await command.execute(interaction, client);
      return;
    }

    // Seleção do tipo de ticket
    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "zenith_ticket_type"
    ) {
      await createTicket(interaction, interaction.values[0]);
      return;
    }

    // Avaliação de tickets
    if (
      interaction.isButton() &&
      interaction.customId.startsWith("feedback:")
    ) {
      await handleTicketFeedback(interaction);
      return;
    }

    // Seleção de membros para adicionar/remover do ticket
    if (
      interaction.isUserSelectMenu() &&
      (
        interaction.customId === "zenith_ticket_add_user_select" ||
        interaction.customId === "zenith_ticket_remove_user_select"
      )
    ) {
      const action = interaction.customId === "zenith_ticket_add_user_select"
        ? "add"
        : "remove";

      await processTicketMemberSelect(interaction, action);
      return;
    }

    // Seleção de canais nas configurações
    if (interaction.isChannelSelectMenu()) {
      if (!canConfigure(interaction)) {
        return safeReply(interaction, {
          content: "❌ Você precisa ser administrador ou responsável pelo Zenith para alterar essas configurações.",
          ephemeral: true
        });
      }

      const selectedChannelId = interaction.values[0];
      const config = guildConfig(interaction.guild.id);

      if (interaction.customId === "config_category_select") {
        const selected = interaction.guild.channels.cache.get(selectedChannelId);

        if (!selected || selected.type !== ChannelType.GuildCategory) {
          return safeReply(interaction, {
            content: "❌ Selecione uma categoria válida.",
            ephemeral: true
          });
        }

        config.ticketCategory = selectedChannelId;
        saveDB();

        await safeReply(interaction, {
          content: `✅ Categoria dos tickets definida para ${selected}.`,
          ephemeral: true
        });
        return;
      }

      if (
        interaction.customId === "config_logs_select" ||
        interaction.customId === "config_feedback_select" ||
        interaction.customId === "config_ticket_panel_channel_select"
      ) {
        const selected = interaction.guild.channels.cache.get(selectedChannelId);

        if (!selected || selected.type !== ChannelType.GuildText) {
          return safeReply(interaction, {
            content: "❌ Selecione um canal de texto válido.",
            ephemeral: true
          });
        }

        if (interaction.customId === "config_logs_select") {
          config.logs = selectedChannelId;
        } else if (interaction.customId === "config_feedback_select") {
          config.feedbackChannel = selectedChannelId;
        } else {
          config.ticketPanelChannel = selectedChannelId;
        }

        saveDB();

        await safeReply(interaction, {
          content: `✅ Configuração atualizada: ${selected}.`,
          ephemeral: true
        });
        return;
      }
    }

    // Botões
    if (interaction.isButton()) {
      const id = interaction.customId;

      if (id === "zenith_close_ticket") {
        await closeTicket(interaction);
        return;
      }

      if (id === "zenith_claim_ticket") {
        await claimTicket(interaction);
        return;
      }

      if (id === "zenith_add_ticket_member") {
        await openTicketMemberSelector(interaction, "add");
        return;
      }

      if (id === "zenith_remove_ticket_member") {
        await openTicketMemberSelector(interaction, "remove");
        return;
      }

      if (id.startsWith("config_")) {
        if (!canConfigure(interaction)) {
          return safeReply(interaction, {
            content: "❌ Você precisa ser administrador ou responsável pelo Zenith para alterar essas configurações.",
            ephemeral: true
          });
        }

        const config = guildConfig(interaction.guild.id);

        if (id === "config_refresh") {
          await interaction.update({
            embeds: [configEmbed(interaction.guild)],
            components: configButtons()
          });
          return;
        }

        if (id === "config_owner") {
          await interaction.showModal(createOwnerModal());
          return;
        }

        if (id === "config_category") {
          await safeReply(interaction, {
            content: "📂 Selecione a categoria onde os tickets serão criados.",
            components: [
              createConfigChannelSelect(
                "config_category_select",
                "Selecionar categoria",
                ChannelType.GuildCategory
              )
            ],
            ephemeral: true
          });
          return;
        }

        if (id === "config_logs") {
          await safeReply(interaction, {
            content: "📋 Selecione o canal onde o Zenith enviará os logs.",
            components: [
              createConfigChannelSelect(
                "config_logs_select",
                "Selecionar canal de logs",
                ChannelType.GuildText
              )
            ],
            ephemeral: true
          });
          return;
        }

        if (id === "config_feedback") {
          await safeReply(interaction, {
            content: "⭐ Selecione o canal para receber os feedbacks.",
            components: [
              createConfigChannelSelect(
                "config_feedback_select",
                "Selecionar canal de feedback",
                ChannelType.GuildText
              )
            ],
            ephemeral: true
          });
          return;
        }

        if (id === "config_panel") {
          await interaction.showModal(createTicketPanelModal(interaction.guild));
          return;
        }

        if (id === "config_send_panel") {
          const channelId = config.ticketPanelChannel;

          if (!channelId) {
            return safeReply(interaction, {
              content: "⚠️ Configure primeiro o canal do painel de tickets.",
              components: [
                createConfigChannelSelect(
                  "config_ticket_panel_channel_select",
                  "Selecionar canal do painel",
                  ChannelType.GuildText
                )
              ],
              ephemeral: true
            });
          }

          const channel = interaction.guild.channels.cache.get(channelId);

          if (!channel || channel.type !== ChannelType.GuildText) {
            config.ticketPanelChannel = null;
            saveDB();

            return safeReply(interaction, {
              content: "⚠️ O canal configurado não existe mais. Selecione outro canal.",
              components: [
                createConfigChannelSelect(
                  "config_ticket_panel_channel_select",
                  "Selecionar canal do painel",
                  ChannelType.GuildText
                )
              ],
              ephemeral: true
            });
          }

          await interaction.deferReply({ ephemeral: true });
          await sendTicketPanel(channel);

          await interaction.editReply({
            content: `✅ Painel de tickets publicado em ${channel}.`
          });
          return;
        }

        if (id === "config_security") {
          await interaction.update({
            embeds: [configSecurityEmbed(interaction.guild)],
            components: configSecurityButtons(interaction.guild)
          });
          return;
        }

        if (id === "config_security_back") {
          await interaction.update({
            embeds: [configEmbed(interaction.guild)],
            components: configButtons()
          });
          return;
        }

        const toggleMap = {
          config_toggle_antiraid: "antiraid",
          config_toggle_antispam: "antispam",
          config_toggle_botProtection: "botProtection"
        };

        if (toggleMap[id]) {
          const setting = toggleMap[id];
          config[setting] = !config[setting];
          saveDB();

          await interaction.update({
            embeds: [configSecurityEmbed(interaction.guild)],
            components: configSecurityButtons(interaction.guild)
          });

          await sendLog(
            interaction.guild,
            "🛡️ Configuração de segurança alterada",
            `**Sistema:** ${setting}\n**Novo estado:** ${config[setting] ? "Ativado" : "Desativado"}\n**Responsável:** ${interaction.user.tag}`
          );
          return;
        }
      }
    }

    // Modais
    if (interaction.isModalSubmit()) {
      if (
        interaction.customId === "config_owner_modal" ||
        interaction.customId === "config_panel_modal"
      ) {
        if (!canConfigure(interaction)) {
          return safeReply(interaction, {
            content: "❌ Você não tem permissão para alterar essas configurações.",
            ephemeral: true
          });
        }

        const config = guildConfig(interaction.guild.id);

        if (interaction.customId === "config_owner_modal") {
          const ownerId = interaction.fields
            .getTextInputValue("zenith_owner_id")
            .trim();

          if (!/^\d{17,20}$/.test(ownerId)) {
            return safeReply(interaction, {
              content: "❌ O ID informado não parece ser um ID válido do Discord.",
              ephemeral: true
            });
          }

          config.zenithOwner = ownerId;
          saveDB();

          await safeReply(interaction, {
            content: `✅ Responsável do Zenith definido para <@${ownerId}>.`,
            ephemeral: true
          });
          return;
        }

        if (interaction.customId === "config_panel_modal") {
          const title = interaction.fields.getTextInputValue("panel_title").trim();
          const description = interaction.fields.getTextInputValue("panel_description").trim();
          const color = interaction.fields.getTextInputValue("panel_color").trim();
          const footer = interaction.fields.getTextInputValue("panel_footer").trim();

          if (!/^#?[0-9a-fA-F]{6}$/.test(color)) {
            return safeReply(interaction, {
              content: "❌ Cor inválida. Use um hexadecimal como `#5865F2`.",
              ephemeral: true
            });
          }

          config.ticketPanel = {
            ...config.ticketPanel,
            title,
            description,
            color: color.startsWith("#") ? color.toUpperCase() : `#${color.toUpperCase()}`,
            footer
          };

          saveDB();

          await safeReply(interaction, {
            content: "✅ Painel personalizado e configurações salvas. Publique o painel novamente para mostrar as alterações.",
            ephemeral: true
          });
          return;
        }
      }
    }
  } catch (error) {
    console.error("[ZENITH] Erro ao processar interação:", error);

    try {
      await safeReply(interaction, {
        content: "❌ Ocorreu um erro ao processar essa interação. Confira as permissões do bot e o console.",
        ephemeral: true
      });
    } catch (replyError) {
      console.error("[ZENITH] Não foi possível responder à interação:", replyError);
    }
  }
});

/* ==========================================
   ZENITH NORMAL — INICIALIZAÇÃO FINAL
   ========================================== */

let server = null;

function startHealthServer() {
  if (server) return server;

  server = http.createServer((req, res) => {
    if (req.url === "/health" || req.url === "/") {
      const body = JSON.stringify({
        status: "online",
        bot: client.user?.tag || "iniciando",
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
      });

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      });

      res.end(body);
      return;
    }

    res.writeHead(404, {
      "Content-Type": "application/json; charset=utf-8"
    });

    res.end(JSON.stringify({
      status: "not_found"
    }));
  });

  server.on("error", (error) => {
    console.error("[ZENITH] Erro no servidor HTTP:", error);
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[WEB] Servidor HTTP ativo na porta ${PORT}`);
  });

  return server;
}

client.once("ready", async () => {
  console.log("======================================");
  console.log(`🤖 Zenith conectado como ${client.user.tag}`);
  console.log(`🆔 ID: ${client.user.id}`);
  console.log(`🌐 Servidores: ${client.guilds.cache.size}`);
  console.log(`📦 Comandos carregados: ${client.commands.size}`);
  console.log("======================================");

  client.user.setPresence({
    activities: [
      {
        name: "Central de Atendimento",
        type: 3
      }
    ],
    status: "online"
  });

  for (const guild of client.guilds.cache.values()) {
    try {
      guildConfig(guild.id);
    } catch (error) {
      console.error(
        `[ZENITH] Erro ao carregar configurações de ${guild.id}:`,
        error
      );
    }
  }

  saveDB();

  try {
    if (typeof updateServerInfo === "function") {
      for (const guild of client.guilds.cache.values()) {
        try {
          await updateServerInfo(guild);
        } catch (error) {
          console.error(
            `[ZENITH] Não foi possível atualizar informações de ${guild.name}:`,
            error.message
          );
        }
      }
    }
  } catch (error) {
    console.error("[ZENITH] Erro ao atualizar informações:", error);
  }

  console.log("[ZENITH] Inicialização concluída.");
});

client.on("guildCreate", async (guild) => {
  console.log(`[ZENITH] Adicionado ao servidor: ${guild.name} (${guild.id})`);

  guildConfig(guild.id);
  saveDB();

  try {
    if (typeof updateServerInfo === "function") {
      await updateServerInfo(guild);
    }
  } catch (error) {
    console.error("[ZENITH] Erro ao atualizar novo servidor:", error);
  }
});

client.on("guildDelete", (guild) => {
  console.log(`[ZENITH] Removido do servidor: ${guild.name} (${guild.id})`);
});

client.on("warn", (warning) => {
  console.warn("[DISCORD WARN]", warning);
});

client.on("error", (error) => {
  console.error("[DISCORD ERROR]", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[ZENITH] Promise rejeitada:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[ZENITH] Exceção não capturada:", error);
});

process.on("SIGTERM", () => {
  console.log("[ZENITH] Encerrando por SIGTERM...");

  if (server) {
    server.close();
  }

  client.destroy();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[ZENITH] Encerrando por SIGINT...");

  if (server) {
    server.close();
  }

  client.destroy();
  process.exit(0);
});

startHealthServer();

if (!TOKEN) {
  console.error(
    "[ZENITH] ERRO: configure DISCORD_TOKEN ou TOKEN nas variáveis de ambiente."
  );
} else {
  client.login(TOKEN).catch((error) => {
    console.error("[ZENITH] Falha ao conectar ao Discord:", error.message);
    process.exitCode = 1;
  });
}
