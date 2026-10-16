
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

console.log(
  "[ZENITH] Comandos carregados:",
  commands.map(command => command.name)
);

// ===============================
// BANCO DE DADOS
// ===============================

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
        JSON.stringify({ guilds: {} }, null, 2)
      );
    }

    const data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));

    if (!data.guilds || typeof data.guilds !== "object") {
      data.guilds = {};
    }

    return data;
  } catch (error) {
    console.error("[ZENITH] Erro ao carregar banco:", error);

    return { guilds: {} };
  }
}

let db = loadDB();

function saveDB() {
  try {
    const tempFile = `${DB_FILE}.tmp`;

    fs.writeFileSync(tempFile, JSON.stringify(db, null, 2));
    fs.renameSync(tempFile, DB_FILE);

    return true;
  } catch (error) {
    console.error("[ZENITH] Erro ao salvar banco:", error);
    return false;
  }
}

function guildConfig(guildId) {
  if (!db.guilds[guildId]) {
    db.guilds[guildId] = {};
  }

  const cfg = db.guilds[guildId];

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

    antiraid: {
      enabled: false,
      threshold: 5,
      interval: 10000
    },

    antispam: {
      enabled: false,
      threshold: 10,
      interval: 5000,
      timeout: 60000
    },

    botProtection: {
      enabled: false,
      autoBlacklist: true,
      threshold: 10,
      interval: 5000
    },

    lockdown: false,

    ticketPanel: {
      title: "🎫 Central de Atendimento",
      description: "Selecione abaixo o tipo de atendimento desejado.",
      color: "#5865F2"
    }
  };

  for (const [key, value] of Object.entries(defaults)) {
    if (cfg[key] === undefined || cfg[key] === null) {
      cfg[key] = structuredClone(value);
    }
  }

  // Corrige configurações antigas sem apagar os dados existentes.
  if (!Array.isArray(cfg.blacklist)) cfg.blacklist = [];
  if (!Array.isArray(cfg.whitelist)) cfg.whitelist = [];
  if (!Array.isArray(cfg.feedbacks)) cfg.feedbacks = [];
  if (!cfg.warns || typeof cfg.warns !== "object") cfg.warns = {};

  if (typeof cfg.antiraid === "boolean") {
    cfg.antiraid = {
      enabled: cfg.antiraid,
      threshold: 5,
      interval: 10000
    };
  }

  if (typeof cfg.antispam === "boolean") {
    cfg.antispam = {
      enabled: cfg.antispam,
      threshold: 10,
      interval: 5000,
      timeout: 60000
    };
  }

  if (typeof cfg.botProtection === "boolean") {
    cfg.botProtection = {
      enabled: cfg.botProtection,
      autoBlacklist: true,
      threshold: 10,
      interval: 5000
    };
  }

  cfg.antiraid = {
    enabled: false,
    threshold: 5,
    interval: 10000,
    ...cfg.antiraid
  };

  cfg.antispam = {
    enabled: false,
    threshold: 10,
    interval: 5000,
    timeout: 60000,
    ...cfg.antispam
  };

  cfg.botProtection = {
    enabled: false,
    autoBlacklist: true,
    threshold: 10,
    interval: 5000,
    ...cfg.botProtection
  };

  return cfg;
}

// ===============================
// CLIENT DISCORD
// ===============================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],

  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.GuildMember
  ]
});

// Evita punições duplicadas enquanto uma ação está em andamento.
const punishmentLocks = new Set();

// Contadores temporários de mensagens.
const messageTracker = new Map();

// Contadores de entrada de membros.
const raidTracker = new Map();

// ===============================
// PROTEÇÃO DE USUÁRIOS
// ===============================

function isZenithOwner(userId, cfg) {
  return Boolean(
    userId &&
    cfg &&
    cfg.zenithOwner &&
    cfg.zenithOwner === userId
  );
}

function isProtected(guild, userId) {
  if (!guild || !userId) return false;

  if (guild.ownerId === userId) return true;

  const cfg = guildConfig(guild.id);

  if (isZenithOwner(userId, cfg)) return true;

  if (cfg.whitelist.includes(userId)) return true;

  const member = guild.members.cache.get(userId);

  if (member?.permissions.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  return false;
}

// ===============================
// LOGS
// ===============================

async function sendLog(guild, title, description, color = 0x5865F2) {
  try {
    if (!guild) return;

    const cfg = guildConfig(guild.id);
    if (!cfg.logs) return;

    const channel =
      guild.channels.cache.get(cfg.logs) ||
      await guild.channels.fetch(cfg.logs).catch(() => null);

    if (!channel || !channel.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(description)
      .setTimestamp();

    await channel.send({ embeds: [embed] }).catch(error => {
      console.error("[ZENITH] Não foi possível enviar log:", error.message);
    });
  } catch (error) {
    console.error("[ZENITH] Erro no sistema de logs:", error);
  }
}

// ===============================
// BLACKLIST AUTOMÁTICA
// ===============================

function addToBlacklist(guildId, userId, reason = "Comportamento suspeito") {
  const cfg = guildConfig(guildId);

  if (!cfg.blacklist.some(entry => {
    if (typeof entry === "string") return entry === userId;
    return entry?.id === userId;
  })) {
    cfg.blacklist.push({
      id: userId,
      reason,
      date: new Date().toISOString(),
      automatic: true
    });
  }

  return saveDB();
}

function isBlacklisted(cfg, userId) {
  return cfg.blacklist.some(entry => {
    if (typeof entry === "string") return entry === userId;
    return entry?.id === userId;
  });
}

// ===============================
// SISTEMA DE PUNIÇÃO
// ===============================

async function punish(guild, userId, reason, action = "timeout") {
  if (!guild || !userId) return false;

  const lockKey = `${guild.id}:${userId}`;

  if (punishmentLocks.has(lockKey)) return false;

  punishmentLocks.add(lockKey);

  try {
    const cfg = guildConfig(guild.id);

    if (isProtected(guild, userId)) {
      return false;
    }

    const member = await guild.members.fetch(userId).catch(() => null);

    if (!member) return false;

    if (action === "kick") {
      if (!member.kickable) {
        await sendLog(
          guild,
          "⚠️ Falha ao expulsar",
          `Não consegui expulsar <@${userId}>.\nMotivo: ${reason}`,
          0xF59E0B
        );

        return false;
      }

      await member.kick(reason);

      await sendLog(
        guild,
        "🚨 Membro expulso",
        `**Usuário:** <@${userId}>\n**ID:** \`${userId}\`\n**Motivo:** ${reason}`,
        0xEF4444
      );

      return true;
    }

    if (action === "timeout") {
      const duration = Math.max(
        1000,
        Math.min(Number(cfg.antispam.timeout) || 60000, 2419200000)
      );

      if (!member.moderatable) return false;

      await member.timeout(duration, reason);

      await sendLog(
        guild,
        "🔇 Timeout aplicado",
        `**Usuário:** <@${userId}>\n**Motivo:** ${reason}\n**Duração:** ${Math.round(duration / 1000)} segundos`,
        0xF59E0B
      );

      return true;
    }

    return false;
  } catch (error) {
    console.error("[ZENITH] Erro ao punir usuário:", error);

    await sendLog(
      guild,
      "❌ Erro de moderação",
      `**ID:** \`${userId}\`\n**Motivo:** ${reason}\n**Erro:** ${error.message}`,
      0xEF4444
    );

    return false;
  } finally {
    punishmentLocks.delete(lockKey);
  }
}

// ===============================
// ANTI-RAID: ENTRADA DE MEMBROS
// ===============================

client.on("guildMemberAdd", async member => {
  try {
    const cfg = guildConfig(member.guild.id);

    if (!cfg.antiraid.enabled) return;

    const now = Date.now();
    const key = member.guild.id;
    const interval = Math.max(1000, Number(cfg.antiraid.interval) || 10000);

    const recent = (raidTracker.get(key) || [])
      .filter(timestamp => now - timestamp < interval);

    recent.push(now);
    raidTracker.set(key, recent);

    const threshold = Math.max(2, Number(cfg.antiraid.threshold) || 5);

    if (recent.length >= threshold) {
      await sendLog(
        member.guild,
        "🚨 Possível Raid Detectado",
        `**Entradas recentes:** ${recent.length}\n**Intervalo:** ${interval / 1000}s\n**Último membro:** <@${member.id}>`,
        0xEF4444
      );
    }
  } catch (error) {
    console.error("[ZENITH] Erro no anti-raid:", error);
  }
});

// ===============================
// ANTI-RAID: AUDIT LOGS
// ===============================

const auditTracker = new Map();

async function detectAudit(guild, executorId, eventName) {
  if (!guild || !executorId) return;

  const cfg = guildConfig(guild.id);

  if (!cfg.antiraid.enabled) return;
  if (isProtected(guild, executorId)) return;

  const now = Date.now();
  const key = `${guild.id}:${executorId}:${eventName}`;
  const interval = Math.max(1000, Number(cfg.antiraid.interval) || 10000);

  const recent = (auditTracker.get(key) || [])
    .filter(timestamp => now - timestamp < interval);

  recent.push(now);
  auditTracker.set(key, recent);

  const threshold = Math.max(2, Number(cfg.antiraid.threshold) || 5);

  if (recent.length >= threshold) {
    await sendLog(
      guild,
      "🚨 Ação suspeita detectada",
      `**Executor:** <@${executorId}>\n**Evento:** ${eventName}\n**Ações recentes:** ${recent.length}`,
      0xEF4444
    );
  }
}

client.on("channelCreate", async channel => {
  if (!channel.guild) return;

  try {
    const logs = await channel.guild.fetchAuditLogs({
      type: AuditLogEvent.ChannelCreate,
      limit: 1
    });

    const entry = logs.entries.first();

    if (entry?.executorId) {
      await detectAudit(channel.guild, entry.executorId, "Criação de canal");
    }
  } catch (error) {
    console.error("[ZENITH] Erro ao verificar criação de canal:", error);
  }
});

client.on("channelDelete", async channel => {
  if (!channel.guild) return;

  try {
    const logs = await channel.guild.fetchAuditLogs({
      type: AuditLogEvent.ChannelDelete,
      limit: 1
    });

    const entry = logs.entries.first();

    if (entry?.executorId) {
      await detectAudit(channel.guild, entry.executorId, "Exclusão de canal");
    }
  } catch (error) {
    console.error("[ZENITH] Erro ao verificar exclusão de canal:", error);
  }
});

client.on("channelUpdate", async (oldChannel, newChannel) => {
  if (!newChannel.guild) return;

  try {
    const logs = await newChannel.guild.fetchAuditLogs({
      type: AuditLogEvent.ChannelUpdate,
      limit: 1
    });

    const entry = logs.entries.first();

    if (entry?.executorId) {
      await detectAudit(newChannel.guild, entry.executorId, "Alteração de canal");
    }
  } catch (error) {
    console.error("[ZENITH] Erro ao verificar alteração de canal:", error);
  }
});

client.on("roleCreate", async role => {
  try {
    const logs = await role.guild.fetchAuditLogs({
      type: AuditLogEvent.RoleCreate,
      limit: 1
    });

    const entry = logs.entries.first();

    if (entry?.executorId) {
      await detectAudit(role.guild, entry.executorId, "Criação de cargo");
    }
  } catch (error) {
    console.error("[ZENITH] Erro ao verificar criação de cargo:", error);
  }
});

client.on("roleDelete", async role => {
  try {
    const logs = await role.guild.fetchAuditLogs({
      type: AuditLogEvent.RoleDelete,
      limit: 1
    });

    const entry = logs.entries.first();

    if (entry?.executorId) {
      await detectAudit(role.guild, entry.executorId, "Exclusão de cargo");
    }
  } catch (error) {
    console.error("[ZENITH] Erro ao verificar exclusão de cargo:", error);
  }
});

/* ===============================
   ANTI-SPAM E ANTI-RAID DE MENSAGENS
================================ */

const spamWarnings = new Map();
const botRaidLocks = new Set();

function getMessageTrackerKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function cleanMessageTracker(key, interval) {
  const now = Date.now();

  const recent = (messageTracker.get(key) || [])
    .filter(entry => now - entry.timestamp < interval);

  messageTracker.set(key, recent);

  return recent;
}

function isBotWhitelisted(cfg, botId) {
  return cfg.whitelist.includes(botId);
}

async function handleBotRaider(message, cfg, recentMessages) {
  const guild = message.guild;
  const bot = message.author;

  if (!guild || !bot?.bot) return false;

  // Bots autorizados não são punidos.
  if (isBotWhitelisted(cfg, bot.id)) return false;

  // Nunca processar o mesmo bot simultaneamente.
  const lockKey = `${guild.id}:${bot.id}`;

  if (botRaidLocks.has(lockKey)) return true;

  const threshold = Math.max(
    2,
    Number(cfg.botProtection.threshold) || 10
  );

  if (recentMessages.length < threshold) return false;

  botRaidLocks.add(lockKey);

  try {
    const reason =
      `Anti-Raid Zenith: bot enviou ${recentMessages.length} mensagens em ` +
      `${Math.round((Number(cfg.botProtection.interval) || 5000) / 1000)} segundos.`;

    // Salva a blacklist antes de tentar expulsar.
    // Assim, a ocorrência não é perdida se o kick falhar.
    const saved = addToBlacklist(guild.id, bot.id, reason);

    if (!saved) {
      await sendLog(
        guild,
        "❌ Erro na blacklist automática",
        `Não foi possível salvar o bot <@${bot.id}> na blacklist.\n` +
        `**ID:** \`${bot.id}\``,
        0xEF4444
      );
    }

    let kicked = false;
    let kickError = null;

    const member = await guild.members.fetch(bot.id).catch(() => null);

    if (member) {
      if (member.kickable) {
        try {
          await member.kick(reason);
          kicked = true;
        } catch (error) {
          kickError = error.message;
        }
      } else {
        kickError = "O Zenith não tem hierarquia ou permissão para expulsar este bot.";
      }
    } else {
      kickError = "O bot já não está no servidor ou não foi possível encontrá-lo.";
    }

    await sendLog(
      guild,
      kicked
        ? "🚨 Bot Raider Expulso"
        : "🚨 Bot Raider Detectado",
      [
        `**Bot:** <@${bot.id}>`,
        `**ID:** \`${bot.id}\``,
        `**Mensagens detectadas:** ${recentMessages.length}`,
        `**Blacklist salva:** ${saved ? "Sim" : "Não"}`,
        `**Expulso:** ${kicked ? "Sim" : "Não"}`,
        `**Motivo:** ${reason}`,
        kickError ? `**Detalhes:** ${kickError}` : null
      ].filter(Boolean).join("\n"),
      kicked ? 0xEF4444 : 0xF59E0B
    );

    return true;
  } catch (error) {
    console.error("[ZENITH] Erro ao tratar bot raider:", error);

    await sendLog(
      guild,
      "❌ Erro no Anti-Raid",
      `Não foi possível concluir a ação contra <@${bot.id}>.\n` +
      `**Erro:** ${error.message}`,
      0xEF4444
    );

    return true;
  } finally {
    botRaidLocks.delete(lockKey);
  }
}

async function handleHumanSpam(message, cfg, recentMessages) {
  const guild = message.guild;
  const user = message.author;

  if (!guild || !user || user.bot) return;

  if (isProtected(guild, user.id)) return;

  const threshold = Math.max(
    2,
    Number(cfg.antispam.threshold) || 10
  );

  if (recentMessages.length < threshold) return;

  const key = `${guild.id}:${user.id}`;

  // Impede que cada mensagem dispare uma nova punição.
  if (spamWarnings.has(key)) return;

  spamWarnings.set(key, Date.now());

  try {
    const reason =
      `Anti-Spam Zenith: ${recentMessages.length} mensagens em ` +
      `${Math.round((Number(cfg.antispam.interval) || 5000) / 1000)} segundos.`;

    await punish(guild, user.id, reason, "timeout");

    await sendLog(
      guild,
      "📨 Spam Detectado",
      `**Usuário:** <@${user.id}>\n` +
      `**Mensagens:** ${recentMessages.length}\n` +
      `**Motivo:** ${reason}`,
      0xF59E0B
    );
  } finally {
    // Permite detectar uma nova ocorrência após 15 segundos.
    // O timer não é necessário: o próximo evento libera o bloqueio.
  }
}

/* ===============================
   EVENTO PRINCIPAL DE MENSAGENS
================================ */

client.on("messageCreate", async message => {
  try {
    if (!message.guild || !message.author) return;
    if (message.author.id === client.user?.id) return;
    if (message.webhookId) return;

    const cfg = guildConfig(message.guild.id);
    const author = message.author;
    const now = Date.now();

    const isBot = author.bot;

    // Bots só entram na detecção se a proteção estiver habilitada.
    if (isBot && !cfg.botProtection.enabled) return;

    // Para humanos, o Anti-Spam precisa estar habilitado.
    if (!isBot && !cfg.antispam.enabled) return;

    // Respeita whitelist, inclusive bots autorizados.
    if (cfg.whitelist.includes(author.id)) return;

    const interval = isBot
      ? Math.max(1000, Number(cfg.botProtection.interval) || 5000)
      : Math.max(1000, Number(cfg.antispam.interval) || 5000);

    const key = getMessageTrackerKey(message.guild.id, author.id);

    const recent = cleanMessageTracker(key, interval);

    recent.push({
      timestamp: now,
      channelId: message.channel.id,
      content: message.content || ""
    });

    messageTracker.set(key, recent);

    if (isBot) {
      await handleBotRaider(message, cfg, recent);
      return;
    }

    await handleHumanSpam(message, cfg, recent);
  } catch (error) {
    console.error("[ZENITH] Erro no detector de mensagens:", error);
  }
});

/* ===============================
   LIMPEZA DE MEMÓRIA TEMPORÁRIA
================================ */

setInterval(() => {
  const now = Date.now();

  for (const [key, messages] of messageTracker.entries()) {
    const recent = messages.filter(
      entry => now - entry.timestamp < 60000
    );

    if (recent.length === 0) {
      messageTracker.delete(key);
    } else {
      messageTracker.set(key, recent);
    }
  }

  for (const [key, timestamp] of spamWarnings.entries()) {
    if (now - timestamp > 15000) {
      spamWarnings.delete(key);
    }
  }

  for (const [key, timestamps] of raidTracker.entries()) {
    const recent = timestamps.filter(
      timestamp => now - timestamp < 60000
    );

    if (recent.length === 0) {
      raidTracker.delete(key);
    } else {
      raidTracker.set(key, recent);
    }
  }

  for (const [key, timestamps] of auditTracker.entries()) {
    const recent = timestamps.filter(
      timestamp => now - timestamp < 60000
    );

    if (recent.length === 0) {
      auditTracker.delete(key);
    } else {
      auditTracker.set(key, recent);
    }
  }
}, 30000).unref();

/* =========================================
   BLACKLIST AUTOMÁTICA NA ENTRADA DO SERVIDOR
========================================= */

client.on("guildMemberAdd", async member => {
  try {
    const cfg = guildConfig(member.guild.id);

    if (!isBlacklisted(cfg, member.id)) return;

    if (cfg.whitelist.includes(member.id)) return;

    const reason = "Usuário ou bot presente na blacklist do Zenith.";
    let kicked = false;

    if (member.kickable) {
      await member.kick(reason);
      kicked = true;
    }

    await sendLog(
      member.guild,
      kicked ? "⛔ Blacklist aplicada" : "⚠️ Blacklist detectada",
      [
        `**Membro:** <@${member.id}>`,
        `**ID:** \`${member.id}\``,
        `**Tipo:** ${member.user.bot ? "Bot" : "Usuário"}`,
        `**Expulso:** ${kicked ? "Sim" : "Não"}`,
        kicked
          ? "**Motivo:** ID encontrado na blacklist."
          : "**Motivo:** Não foi possível expulsar. Verifique as permissões e a hierarquia do Zenith."
      ].join("\n"),
      0xEF4444
    );
  } catch (error) {
    console.error("[ZENITH] Erro ao verificar blacklist na entrada:", error);
  }
});

/* =========================================
   CONFIGURAÇÃO DE TICKETS
========================================= */

function ticketTypeLabel(type) {
  const labels = {
    suporte: "🛠️ Suporte",
    denuncia: "🚨 Denúncia",
    duvida: "❓ Dúvida",
    compra: "🛒 Compras"
  };

  return labels[type] || "🎫 Atendimento";
}

function configEmbed(guild) {
  const cfg = guildConfig(guild.id);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle("⚙️ Central de Configuração — Zenith")
    .setDescription(
      "Configure os principais sistemas do bot utilizando os botões abaixo."
    )
    .addFields(
      {
        name: "👑 Responsável do Zenith",
        value: cfg.zenithOwner ? `<@${cfg.zenithOwner}>` : "Não configurado",
        inline: true
      },
      {
        name: "📁 Categoria de tickets",
        value: cfg.ticketCategory
          ? `<#${cfg.ticketCategory}>`
          : "Não configurada",
        inline: true
      },
      {
        name: "📋 Painel de tickets",
        value: cfg.ticketPanelChannel
          ? `<#${cfg.ticketPanelChannel}>`
          : "Não configurado",
        inline: true
      },
      {
        name: "📝 Canal de logs",
        value: cfg.logs ? `<#${cfg.logs}>` : "Não configurado",
        inline: true
      },
      {
        name: "⭐ Canal de avaliações",
        value: cfg.feedbackChannel
          ? `<#${cfg.feedbackChannel}>`
          : "Não configurado",
        inline: true
      },
      {
        name: "🛡️ Anti-Raid",
        value: cfg.antiraid.enabled ? "Ativado" : "Desativado",
        inline: true
      },
      {
        name: "📨 Anti-Spam",
        value: cfg.antispam.enabled ? "Ativado" : "Desativado",
        inline: true
      },
      {
        name: "🤖 Proteção contra bots",
        value: cfg.botProtection.enabled ? "Ativada" : "Desativada",
        inline: true
      }
    )
    .setFooter({ text: "Zenith • Sistema de configuração" })
    .setTimestamp();

  return embed;
}

/* =========================================
   PAINEL PÚBLICO DE TICKETS
========================================= */

function buildTicketPanel(cfg) {
  const panel = cfg.ticketPanel || {};

  const embed = new EmbedBuilder()
    .setColor(panel.color || "#5865F2")
    .setTitle(panel.title || "🎫 Central de Atendimento")
    .setDescription(
      panel.description ||
      "Precisa de ajuda? Escolha abaixo o tipo de atendimento."
    )
    .setFooter({ text: "Zenith • Atendimento" })
    .setTimestamp();

  const menu = new StringSelectMenuBuilder()
    .setCustomId("zenith_ticket_type")
    .setPlaceholder("Selecione o tipo de atendimento")
    .addOptions(
      {
        label: "Suporte",
        description: "Preciso de ajuda com alguma coisa.",
        value: "suporte",
        emoji: "🛠️"
      },
      {
        label: "Denúncia",
        description: "Quero fazer uma denúncia.",
        value: "denuncia",
        emoji: "🚨"
      },
      {
        label: "Dúvida",
        description: "Tenho uma dúvida.",
        value: "duvida",
        emoji: "❓"
      },
      {
        label: "Compras",
        description: "Preciso de ajuda com uma compra.",
        value: "compra",
        emoji: "🛒"
      }
    );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)]
  };
}

/* =========================================
   IDENTIFICAÇÃO DE CANAIS DE TICKET
========================================= */

function isTicketChannel(channel, userId = null) {
  if (!channel || !channel.topic) return false;

  const match = channel.topic.match(/^ZENITH_TICKET:(\d+)/);

  if (!match) return false;

  return userId ? match[1] === userId : true;
}

function getTicketOwnerId(channel) {
  if (!channel?.topic) return null;

  const match = channel.topic.match(/^ZENITH_TICKET:(\d+)/);

  return match ? match[1] : null;
}

/* =========================================
   ABERTURA DE TICKET
========================================= */

async function createTicket(interaction, type) {
  const guild = interaction.guild;
  const user = interaction.user;

  if (!guild) {
    return interaction.reply({
      content: "Este sistema só funciona dentro de um servidor.",
      ephemeral: true
    });
  }

  const cfg = guildConfig(guild.id);

  const existing = guild.channels.cache.find(channel =>
    channel.type === ChannelType.GuildText &&
    isTicketChannel(channel, user.id)
  );

  if (existing) {
    return interaction.reply({
      content: `Você já tem um ticket aberto: ${existing}`,
      ephemeral: true
    });
  }

  const category = cfg.ticketCategory
    ? guild.channels.cache.get(cfg.ticketCategory)
    : null;

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

  const adminRole = guild.roles.cache.find(
    role => role.name === "🛡️ Administrador"
  );

  if (adminRole) {
    permissionOverwrites.push({
      id: adminRole.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages
      ]
    });
  }

  await interaction.deferReply({ ephemeral: true });

  let channel;

  try {
    channel = await guild.channels.create({
      name: `${type}-${user.username}`
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 90),
      type: ChannelType.GuildText,
      topic: `ZENITH_TICKET:${user.id}`,
      parent:
        category?.type === ChannelType.GuildCategory
          ? category.id
          : undefined,
      permissionOverwrites,
      reason: `Ticket ${type} aberto por ${user.tag}`
    });

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`🎫 ${ticketTypeLabel(type)}`)
      .setDescription(
        `Olá <@${user.id}>!\n\n` +
        "Nossa equipe atenderá você por este canal privado.\n" +
        "Explique o motivo do contato e aguarde um membro da equipe."
      )
      .addFields(
        { name: "👤 Criado por", value: `<@${user.id}>`, inline: true },
        { name: "📌 Categoria", value: ticketTypeLabel(type), inline: true },
        { name: "🟢 Status", value: "Aberto", inline: true }
      )
      .setFooter({ text: "Zenith • Atendimento" })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("zenith_close_ticket")
        .setLabel("Fechar")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId("zenith_claim_ticket")
        .setLabel("Assumir")
        .setEmoji("🙋")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("zenith_add_member")
        .setLabel("Adicionar membro")
        .setEmoji("➕")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("zenith_remove_member")
        .setLabel("Remover membro")
        .setEmoji("➖")
        .setStyle(ButtonStyle.Secondary)
    );

    await channel.send({
      content: `<@${user.id}>`,
      embeds: [embed],
      components: [row]
    });

    await interaction.editReply({
      content: `✅ Ticket criado: ${channel}`
    });

    await sendLog(
      guild,
      "🎫 Ticket aberto",
      `**Canal:** ${channel}\n` +
      `**Usuário:** <@${user.id}>\n` +
      `**Tipo:** ${ticketTypeLabel(type)}`,
      0x22C55E
    );
  } catch (error) {
    console.error("[ZENITH] Erro ao criar ticket:", error);

    if (channel) {
      await channel.delete("Falha durante a criação do ticket")
        .catch(() => null);
    }

    await interaction.editReply({
      content:
        "❌ Não consegui criar o ticket. Verifique as permissões do Zenith " +
        "e se a categoria configurada ainda existe."
    }).catch(() => null);
  }
}

/* =========================================
   AVALIAÇÃO DE ATENDIMENTO POR DM
========================================= */

async function sendTicketRating(user, guild, channelName) {
  try {
    const embed = new EmbedBuilder()
      .setColor(0xF59E0B)
      .setTitle("⭐ Avalie seu atendimento")
      .setDescription(
        `Seu atendimento em **${guild.name}** foi encerrado.\n` +
        "Como foi sua experiência? Escolha uma nota de 1 a 5."
      )
      .setFooter({ text: "Zenith • Feedback" });

    const row = new ActionRowBuilder().addComponents(
      [1, 2, 3, 4, 5].map(rating =>
        new ButtonBuilder()
          .setCustomId(`zenith_rating_${rating}_${guild.id}`)
          .setLabel(String(rating))
          .setEmoji("⭐")
          .setStyle(
            rating >= 4
              ? ButtonStyle.Success
              : rating === 3
                ? ButtonStyle.Primary
                : ButtonStyle.Secondary
          )
      )
    );

    await user.send({
      embeds: [embed],
      components: [row]
    });
  } catch {
    await sendLog(
      guild,
      "⚠️ Avaliação não enviada",
      `Não consegui enviar a avaliação por DM para <@${user.id}>.\n` +
      `**Ticket:** ${channelName}`,
      0xF59E0B
    );
  }
}

/* =========================================
   FECHAMENTO DE TICKET
========================================= */

async function closeTicket(interaction) {
  const channel = interaction.channel;
  const guild = interaction.guild;

  if (!channel || !guild || !isTicketChannel(channel)) {
    return interaction.reply({
      content: "❌ Este canal não é um ticket válido.",
      ephemeral: true
    });
  }

  const cfg = guildConfig(guild.id);
  const ownerId = getTicketOwnerId(channel);
  const isAdmin = interaction.memberPermissions?.has(
    PermissionFlagsBits.Administrator
  );

  const adminRole = guild.roles.cache.find(
    role => role.name === "🛡️ Administrador"
  );

  const hasAdminRole = Boolean(
    adminRole && interaction.member.roles?.cache?.has(adminRole.id)
  );

  // O dono do ticket pode fechar. Administradores também.
  if (
    interaction.user.id !== ownerId &&
    !isAdmin &&
    !hasAdminRole &&
    !isZenithOwner(interaction.user.id, cfg)
  ) {
    return interaction.reply({
      content: "❌ Você não tem permissão para fechar este ticket.",
      ephemeral: true
    });
  }

  await interaction.deferReply();

  try {
    const messages = [];
    let lastId;

    // Busca até 500 mensagens para montar o transcript.
    for (let page = 0; page < 5; page++) {
      const batch = await channel.messages.fetch({
        limit: 100,
        ...(lastId ? { before: lastId } : {})
      });

      if (!batch.size) break;

      messages.push(...batch.values());
      lastId = batch.last().id;

      if (batch.size < 100) break;
    }

    const transcript = messages
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map(message => {
        const content = message.content || "[Mensagem sem texto]";
        const attachments = [...message.attachments.values()]
          .map(attachment => attachment.url)
          .join(" ");

        return (
          `[${new Date(message.createdTimestamp).toISOString()}] ` +
          `${message.author.tag}: ${content} ${attachments}`
        );
      })
      .join("\n");

    const owner = await client.users.fetch(ownerId).catch(() => null);

    if (owner) {
      await sendTicketRating(owner, guild, channel.name);
    }

    await sendLog(
      guild,
      "🔒 Ticket encerrado",
      `**Canal:** #${channel.name}\n` +
      `**Dono:** ${ownerId ? `<@${ownerId}>` : "Desconhecido"}\n` +
      `**Fechado por:** <@${interaction.user.id}>\n` +
      `**Mensagens no transcript:** ${messages.length}\n\n` +
      "O transcript foi preparado em memória. Para arquivá-lo, " +
      "é necessário enviá-lo como arquivo ao canal de logs.",
      0xEF4444
    );

    await interaction.editReply({
      content: "🔒 Ticket encerrado. O canal será removido em instantes."
    });

    // Evita que o usuário continue interagindo enquanto o canal é apagado.
    await channel.permissionOverwrites.edit(ownerId, {
      SendMessages: false
    }).catch(() => null);

    setTimeout(() => {
      channel.delete("Ticket fechado pelo sistema Zenith").catch(error => {
        console.error("[ZENITH] Erro ao excluir ticket:", error);
      });
    }, 1500);
  } catch (error) {
    console.error("[ZENITH] Erro ao fechar ticket:", error);

    await interaction.editReply({
      content: "❌ Ocorreu um erro ao fechar o ticket."
    }).catch(() => null);
  }
}

/* =========================================
   UTILITÁRIOS DE INTERAÇÃO
========================================= */

function hasAdministratorPermission(interaction) {
  return Boolean(
    interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    )
  );
}

function hasZenithAdminRole(interaction) {
  const role = interaction.guild?.roles.cache.find(
    item => item.name === "🛡️ Administrador"
  );

  return Boolean(
    role && interaction.member?.roles?.cache?.has(role.id)
  );
}

function canManageZenith(interaction) {
  const cfg = guildConfig(interaction.guildId);

  return (
    hasAdministratorPermission(interaction) ||
    hasZenithAdminRole(interaction) ||
    isZenithOwner(interaction.user.id, cfg)
  );
}

async function replySafe(interaction, options) {
  try {
    if (interaction.deferred) {
      return await interaction.editReply(options);
    }

    if (interaction.replied) {
      return await interaction.followUp({
        ...options,
        ephemeral: true
      });
    }

    return await interaction.reply({
      ...options,
      ephemeral: true
    });
  } catch (error) {
    console.error("[ZENITH] Erro ao responder interação:", error.message);
  }
}

function getOption(interaction, name) {
  return interaction.options.getUser(name) ||
    interaction.options.getString(name) ||
    interaction.options.getChannel(name) ||
    interaction.options.getBoolean(name) ||
    interaction.options.getInteger(name);
}

/* =========================================
   COMANDO /INFO
========================================= */

async function executeInfo(interaction) {
  const guild = interaction.guild;

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle("ℹ️ Zenith — Informações")
    .setDescription(
      "Bot de moderação, segurança, atendimento e automação."
    )
    .addFields(
      {
        name: "🤖 Bot",
        value: `${client.user.tag}`,
        inline: true
      },
      {
        name: "👥 Membros",
        value: String(guild?.memberCount ?? "N/A"),
        inline: true
      },
      {
        name: "📡 Latência",
        value: `${client.ws.ping} ms`,
        inline: true
      },
      {
        name: "🛡️ Segurança",
        value: "Anti-Raid, Anti-Spam e proteção contra bots",
        inline: false
      }
    )
    .setFooter({ text: "Zenith • Sistema de informações" })
    .setTimestamp();

  return interaction.reply({
    embeds: [embed],
    ephemeral: true
  });
}

/* =========================================
   COMANDO /SETUP
========================================= */

async function executeSetup(interaction) {
  if (!canManageZenith(interaction)) {
    return replySafe(interaction, {
      content: "❌ Você precisa ser administrador para configurar o Zenith."
    });
  }

  return interaction.reply({
    embeds: [configEmbed(interaction.guild)],
    ephemeral: true
  });
}

/* =========================================
   COMANDO /CONFIG
========================================= */

async function executeConfig(interaction) {
  if (!canManageZenith(interaction)) {
    return replySafe(interaction, {
      content: "❌ Você não tem permissão para configurar o Zenith."
    });
  }

  return interaction.reply({
    embeds: [configEmbed(interaction.guild)],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("zenith_config_owner")
          .setLabel("Responsável")
          .setEmoji("👑")
          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
          .setCustomId("zenith_config_logs")
          .setLabel("Canal de logs")
          .setEmoji("📝")
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId("zenith_config_category")
          .setLabel("Categoria de tickets")
          .setEmoji("📁")
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId("zenith_config_feedback")
          .setLabel("Canal de avaliações")
          .setEmoji("⭐")
          .setStyle(ButtonStyle.Secondary)
      )
    ],
    ephemeral: true
  });
}

/* =========================================
   COMANDO /TICKET
========================================= */

async function executeTicket(interaction) {
  const cfg = guildConfig(interaction.guildId);
  const subcommand = interaction.options.getSubcommand(false);

  if (subcommand === "painel") {
    if (!canManageZenith(interaction)) {
      return replySafe(interaction, {
        content: "❌ Você não tem permissão para publicar o painel."
      });
    }

    const selectedChannel = interaction.options.getChannel("canal");
    const channel = selectedChannel ||
      (cfg.ticketPanelChannel
        ? interaction.guild.channels.cache.get(cfg.ticketPanelChannel)
        : null);

    if (!channel || !channel.isTextBased()) {
      return replySafe(interaction, {
        content: "❌ Informe um canal de texto válido."
      });
    }

    const panel = buildTicketPanel(cfg);

    await channel.send(panel);

    cfg.ticketPanelChannel = channel.id;
    saveDB();

    return replySafe(interaction, {
      content: `✅ Painel de tickets publicado em ${channel}.`
    });
  }

  if (subcommand === "categoria") {
    if (!canManageZenith(interaction)) {
      return replySafe(interaction, {
        content: "❌ Você não tem permissão para alterar a categoria."
      });
    }

    const category = interaction.options.getChannel("canal");

    if (!category || category.type !== ChannelType.GuildCategory) {
      return replySafe(interaction, {
        content: "❌ Selecione uma categoria válida."
      });
    }

    cfg.ticketCategory = category.id;
    saveDB();

    return replySafe(interaction, {
      content: `✅ Categoria dos tickets definida para ${category}.`
    });
  }

  if (subcommand === "editar") {
    if (!canManageZenith(interaction)) {
      return replySafe(interaction, {
        content: "❌ Você não tem permissão para editar o painel."
      });
    }

    const modal = new ModalBuilder()
      .setCustomId("ticket_edit_modal")
      .setTitle("Editar painel de tickets");

    const titleInput = new TextInputBuilder()
      .setCustomId("ticket_title")
      .setLabel("Título do painel")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(256)
      .setValue(cfg.ticketPanel.title || "🎫 Central de Atendimento");

    const descriptionInput = new TextInputBuilder()
      .setCustomId("ticket_description")
      .setLabel("Descrição")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(4000)
      .setValue(
        cfg.ticketPanel.description ||
        "Selecione abaixo o tipo de atendimento desejado."
      );

    modal.addComponents(
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(descriptionInput)
    );

    return interaction.showModal(modal);
  }

  return replySafe(interaction, {
    content: "Use `/ticket painel`, `/ticket categoria` ou `/ticket editar`."
  });
}

/* =========================================
   COMANDO /SECURITY
========================================= */

async function executeSecurity(interaction) {
  if (!canManageZenith(interaction)) {
    return replySafe(interaction, {
      content: "❌ Você não tem permissão para configurar a segurança."
    });
  }

  const cfg = guildConfig(interaction.guildId);
  const subcommand = interaction.options.getSubcommand(false);
  const enabled = interaction.options.getBoolean("ativar");

  if (subcommand === "antiraid") {
    cfg.antiraid.enabled = enabled ?? !cfg.antiraid.enabled;
  } else if (subcommand === "antispam") {
    cfg.antispam.enabled = enabled ?? !cfg.antispam.enabled;
  } else if (
    subcommand === "botprotection" ||
    subcommand === "antibot"
  ) {
    cfg.botProtection.enabled =
      enabled ?? !cfg.botProtection.enabled;
  } else {
    return replySafe(interaction, {
      content: "❌ Sistema de segurança desconhecido."
    });
  }

  saveDB();

  return replySafe(interaction, {
    embeds: [
      new EmbedBuilder()
        .setColor(0x22C55E)
        .setTitle("🛡️ Segurança atualizada")
        .setDescription(
          `**Anti-Raid:** ${cfg.antiraid.enabled ? "Ativado" : "Desativado"}\n` +
          `**Anti-Spam:** ${cfg.antispam.enabled ? "Ativado" : "Desativado"}\n` +
          `**Proteção de bots:** ${cfg.botProtection.enabled ? "Ativada" : "Desativada"}\n\n` +
          `**Anti-Raid:** ${cfg.antiraid.threshold} entradas/ações em ${cfg.antiraid.interval / 1000}s\n` +
          `**Anti-Spam:** ${cfg.antispam.threshold} mensagens em ${cfg.antispam.interval / 1000}s\n` +
          `**Bots:** ${cfg.botProtection.threshold} mensagens em ${cfg.botProtection.interval / 1000}s`
        )
    ]
  });
}

/* =========================================
   COMANDO /BLACKLIST
========================================= */

async function executeBlacklist(interaction) {
  if (!canManageZenith(interaction)) {
    return replySafe(interaction, {
      content: "❌ Você não tem permissão para gerenciar a blacklist."
    });
  }

  const cfg = guildConfig(interaction.guildId);
  const subcommand = interaction.options.getSubcommand(false);
  const user = interaction.options.getUser("usuario");

  if (subcommand === "list") {
    if (!cfg.blacklist.length) {
      return replySafe(interaction, {
        content: "A blacklist está vazia."
      });
    }

    const lines = cfg.blacklist.slice(0, 40).map(entry => {
      if (typeof entry === "string") {
        return `• \`${entry}\``;
      }

      return (
        `• \`${entry.id}\` — ${entry.reason || "Sem motivo informado"}` +
        `${entry.automatic ? " *(automática)*" : ""}`
      );
    });

    return replySafe(interaction, {
      embeds: [
        new EmbedBuilder()
          .setColor(0xEF4444)
          .setTitle("⛔ Blacklist do Zenith")
          .setDescription(lines.join("\n"))
          .setFooter({
            text: `Total de entradas: ${cfg.blacklist.length}`
          })
      ]
    });
  }

  if (!user) {
    return replySafe(interaction, {
      content: "❌ Informe o usuário."
    });
  }

  if (subcommand === "add") {
    if (user.id === interaction.user.id || user.id === client.user.id) {
      return replySafe(interaction, {
        content: "❌ Não é possível adicionar esse usuário à blacklist."
      });
    }

    addToBlacklist(
      interaction.guildId,
      user.id,
      "Adicionado manualmente por " + interaction.user.tag
    );

    return replySafe(interaction, {
      content: `✅ <@${user.id}> foi adicionado à blacklist.`
    });
  }

  if (subcommand === "remove") {
    cfg.blacklist = cfg.blacklist.filter(entry => {
      return typeof entry === "string"
        ? entry !== user.id
        : entry?.id !== user.id;
    });

    saveDB();

    return replySafe(interaction, {
      content: `✅ <@${user.id}> foi removido da blacklist.`
    });
  }

  return replySafe(interaction, {
    content: "Use `/blacklist list`, `/blacklist add` ou `/blacklist remove`."
  });
}

/* =========================================
   COMANDO /WHITELIST
========================================= */

async function executeWhitelist(interaction) {
  if (!canManageZenith(interaction)) {
    return replySafe(interaction, {
      content: "❌ Você não tem permissão para gerenciar a whitelist."
    });
  }

  const cfg = guildConfig(interaction.guildId);
  const subcommand = interaction.options.getSubcommand(false);
  const user = interaction.options.getUser("usuario");

  if (subcommand === "list") {
    return replySafe(interaction, {
      content: cfg.whitelist.length
        ? cfg.whitelist.map(id => `• <@${id}> (\`${id}\`)`).join("\n")
        : "A whitelist está vazia."
    });
  }

  if (!user) {
    return replySafe(interaction, {
      content: "❌ Informe o usuário."
    });
  }

  if (subcommand === "add") {
    if (!cfg.whitelist.includes(user.id)) {
      cfg.whitelist.push(user.id);
    }

    // A whitelist também evita ações automáticas futuras.
    saveDB();

    return replySafe(interaction, {
      content: `✅ <@${user.id}> foi adicionado à whitelist.`
    });
  }

  if (subcommand === "remove") {
    cfg.whitelist = cfg.whitelist.filter(id => id !== user.id);
    saveDB();

    return replySafe(interaction, {
      content: `✅ <@${user.id}> foi removido da whitelist.`
    });
  }

  return replySafe(interaction, {
    content: "Use `/whitelist list`, `/whitelist add` ou `/whitelist remove`."
  });
}

/* =========================================
   COMANDO /LOGS
========================================= */

async function executeLogs(interaction) {
  if (!canManageZenith(interaction)) {
    return replySafe(interaction, {
      content: "❌ Você não tem permissão para configurar os logs."
    });
  }

  const channel = interaction.options.getChannel("canal");

  if (!channel || !channel.isTextBased()) {
    return replySafe(interaction, {
      content: "❌ Selecione um canal de texto válido."
    });
  }

  const cfg = guildConfig(interaction.guildId);
  cfg.logs = channel.id;
  saveDB();

  return replySafe(interaction, {
    content: `✅ Canal de logs configurado: ${channel}.`
  });
}

/* =========================================
   COMANDO /LOCKDOWN
========================================= */

async function executeLockdown(interaction) {
  if (!canManageZenith(interaction)) {
    return replySafe(interaction, {
      content: "❌ Você não tem permissão para usar o lockdown."
    });
  }

  const cfg = guildConfig(interaction.guildId);
  const enabled = interaction.options.getBoolean("ativar");

  cfg.lockdown = enabled ?? !cfg.lockdown;
  saveDB();

  const everyone = interaction.guild.roles.everyone;
  let changed = 0;

  for (const channel of interaction.guild.channels.cache.values()) {
    if (!channel.isTextBased() || !channel.permissionOverwrites) continue;

    try {
      if (cfg.lockdown) {
        await channel.permissionOverwrites.edit(everyone, {
          SendMessages: false
        });

        changed++;
      } else {
        await channel.permissionOverwrites.edit(everyone, {
          SendMessages: null
        });

        changed++;
      }
    } catch (error) {
      console.error(
        "[ZENITH] Não foi possível alterar o canal",
        channel.id,
        error.message
      );
    }
  }

  await sendLog(
    interaction.guild,
    cfg.lockdown ? "🔒 Lockdown ativado" : "🔓 Lockdown desativado",
    `**Responsável:** <@${interaction.user.id}>\n` +
    `**Canais processados:** ${changed}`,
    cfg.lockdown ? 0xEF4444 : 0x22C55E
  );

  return replySafe(interaction, {
    content:
      `${cfg.lockdown ? "🔒 Lockdown ativado" : "🔓 Lockdown desativado"}. ` +
      `${changed} canais processados.`
  });
}

/* =========================================
   COMANDOS DE MODERAÇÃO
========================================= */

async function executeModeration(interaction) {
  if (!canManageZenith(interaction)) {
    return replySafe(interaction, {
      content: "❌ Você não tem permissão para moderar membros."
    });
  }

  const command = interaction.commandName;
  const user = interaction.options.getUser("usuario");
  const reason =
    interaction.options.getString("motivo") || "Sem motivo informado";

  if (!user) {
    return replySafe(interaction, {
      content: "❌ Informe o usuário."
    });
  }

  if (user.id === interaction.user.id || user.id === client.user.id) {
    return replySafe(interaction, {
      content: "❌ Você não pode aplicar essa ação a esse usuário."
    });
  }

  if (isProtected(interaction.guild, user.id)) {
    return replySafe(interaction, {
      content: "❌ Esse usuário está protegido pelo sistema do Zenith."
    });
  }

  const member = await interaction.guild.members.fetch(user.id)
    .catch(() => null);

  if (!member) {
    return replySafe(interaction, {
      content: "❌ Esse usuário não está no servidor."
    });
  }

  if (command === "ban") {
    if (!member.bannable) {
      return replySafe(interaction, {
        content: "❌ Não consigo banir esse membro. Verifique a hierarquia."
      });
    }

    await member.ban({ reason });

    await sendLog(
      interaction.guild,
      "🔨 Membro banido",
      `**Usuário:** <@${user.id}>\n**Responsável:** <@${interaction.user.id}>\n**Motivo:** ${reason}`,
      0xEF4444
    );

    return replySafe(interaction, {
      content: `🔨 <@${user.id}> foi banido.`
    });
  }

  if (command === "kick") {
    if (!member.kickable) {
      return replySafe(interaction, {
        content: "❌ Não consigo expulsar esse membro. Verifique a hierarquia."
      });
    }

    await member.kick(reason);

    await sendLog(
      interaction.guild,
      "👢 Membro expulso",
      `**Usuário:** <@${user.id}>\n**Responsável:** <@${interaction.user.id}>\n**Motivo:** ${reason}`,
      0xF59E0B
    );

    return replySafe(interaction, {
      content: `👢 <@${user.id}> foi expulso.`
    });
  }

  if (command === "warn") {
    const cfg = guildConfig(interaction.guildId);

    if (!Array.isArray(cfg.warns[user.id])) {
      cfg.warns[user.id] = [];
    }

    cfg.warns[user.id].push({
      reason,
      moderator: interaction.user.id,
      date: new Date().toISOString()
    });

    saveDB();

    await sendLog(
      interaction.guild,
      "⚠️ Advertência aplicada",
      `**Usuário:** <@${user.id}>\n**Responsável:** <@${interaction.user.id}>\n**Motivo:** ${reason}\n**Total de advertências:** ${cfg.warns[user.id].length}`,
      0xF59E0B
    );

    return replySafe(interaction, {
      content: `⚠️ Advertência aplicada a <@${user.id}>.`
    });
  }

  return replySafe(interaction, {
    content: "❌ Comando de moderação desconhecido."
  });
}

/* =========================================
   HANDLER DE COMANDOS SLASH
========================================= */

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (!interaction.guild) {
        return replySafe(interaction, {
          content: "Este comando só funciona dentro de um servidor."
        });
      }

      const name = interaction.commandName;

      if (name === "info") return await executeInfo(interaction);
      if (name === "setup") return await executeSetup(interaction);
      if (name === "config") return await executeConfig(interaction);
      if (name === "ticket") return await executeTicket(interaction);
      if (name === "security") return await executeSecurity(interaction);
      if (name === "blacklist") return await executeBlacklist(interaction);
      if (name === "whitelist") return await executeWhitelist(interaction);
      if (name === "logs") return await executeLogs(interaction);
      if (name === "lockdown") return await executeLockdown(interaction);

      if (["ban", "kick", "warn"].includes(name)) {
        return await executeModeration(interaction);
      }

      return replySafe(interaction, {
        content: `O comando \`/${name}\` ainda não possui um handler neste arquivo.`
      });
    }

    /* ===============================
       MENU DE TICKETS
    =============================== */

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "zenith_ticket_type") {
        return await createTicket(
          interaction,
          interaction.values[0]
        );
      }
    }

    /* ===============================
       BOTÕES
    =============================== */

    if (interaction.isButton()) {
      const id = interaction.customId;
      const cfg = interaction.guild
        ? guildConfig(interaction.guild.id)
        : null;

      if (id === "zenith_close_ticket") {
        return await closeTicket(interaction);
      }

      if (id === "zenith_claim_ticket") {
        if (
          !interaction.guild ||
          !isTicketChannel(interaction.channel)
        ) {
          return replySafe(interaction, {
            content: "❌ Este botão só pode ser usado em um ticket.",
            ephemeral: true
          });
        }

        if (
          !hasAdministratorPermission(interaction) &&
          !hasZenithAdminRole(interaction)
        ) {
          return replySafe(interaction, {
            content: "❌ Você não tem permissão para assumir este ticket.",
            ephemeral: true
          });
        }

        return replySafe(interaction, {
          content: `🛡️ Ticket assumido por ${interaction.user}.`,
          ephemeral: false
        });
      }

      if (
        id === "zenith_add_member" ||
        id === "zenith_remove_member"
      ) {
        if (
          !interaction.guild ||
          !isTicketChannel(interaction.channel)
        ) {
          return replySafe(interaction, {
            content: "❌ Este botão só pode ser usado em um ticket.",
            ephemeral: true
          });
        }

        if (
          !hasAdministratorPermission(interaction) &&
          !hasZenithAdminRole(interaction)
        ) {
          return replySafe(interaction, {
            content: "❌ Você não tem permissão para fazer isso.",
            ephemeral: true
          });
        }

        const modal = new ModalBuilder()
          .setCustomId(
            id === "zenith_add_member"
              ? "zenith_add_member_modal"
              : "zenith_remove_member_modal"
          )
          .setTitle(
            id === "zenith_add_member"
              ? "Adicionar membro ao ticket"
              : "Remover membro do ticket"
          );

        const memberInput = new TextInputBuilder()
          .setCustomId("member_id")
          .setLabel("ID do usuário")
          .setPlaceholder("Digite o ID do usuário do Discord")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(memberInput)
        );

        return interaction.showModal(modal);
      }

      if (id.startsWith("zenith_rating_")) {
        const match = id.match(/^zenith_rating_(\d+)_(\d+)$/);

        if (!match) {
          return replySafe(interaction, {
            content: "❌ Avaliação inválida.",
            ephemeral: true
          });
        }

        const rating = Number(match[1]);
        const guildId = match[2];

        if (!cfg || !interaction.guild) {
          return replySafe(interaction, {
            content: "❌ Não foi possível identificar o servidor.",
            ephemeral: true
          });
        }

        cfg.feedbacks ??= [];
        cfg.feedbacks.push({
          userId: interaction.user.id,
          rating,
          date: new Date().toISOString()
        });

        saveDB();

        if (cfg.feedbackChannel) {
          const feedbackChannel =
            interaction.guild.channels.cache.get(cfg.feedbackChannel);

          if (feedbackChannel?.isTextBased()) {
            await feedbackChannel.send({
              embeds: [
                new EmbedBuilder()
                  .setColor("#5865F2")
                  .setTitle("⭐ Nova avaliação de atendimento")
                  .setDescription(
                    `**Usuário:** ${interaction.user}\n` +
                    `**Nota:** ${rating}/5`
                  )
                  .setTimestamp()
              ]
            }).catch(() => {});
          }
        }

        return replySafe(interaction, {
          content: "✅ Obrigado por avaliar nosso atendimento!",
          ephemeral: true
        });
      }

      if (id.startsWith("zenith_config_")) {
        if (!interaction.guild || !canManageZenith(interaction)) {
          return replySafe(interaction, {
            content: "❌ Você não tem permissão para configurar o Zenith.",
            ephemeral: true
          });
        }

        const isOwner = id === "zenith_config_owner";

        const modal = new ModalBuilder()
          .setCustomId(
            isOwner
              ? "config_owner_modal"
              : `${id}_modal`
          )
          .setTitle(
            isOwner
              ? "Configurar responsável"
              : "Configurar canal ou categoria"
          );

        const input = new TextInputBuilder()
          .setCustomId(isOwner ? "owner_id" : "channel_id")
          .setLabel(
            isOwner
              ? "ID do responsável"
              : "ID do canal ou categoria"
          )
          .setPlaceholder("Digite o ID")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(input)
        );

        return interaction.showModal(modal);
      }
    }

/* ===============================
   MODAIS DOS TICKETS E CONFIGURAÇÃO
=============================== */

client.on("interactionCreate", async interaction => {
  if (!interaction.isModalSubmit()) return;

  try {
    const guild = interaction.guild;

    if (!guild) {
      return replySafe(interaction, {
        content: "❌ Este formulário precisa ser usado em um servidor.",
        ephemeral: true
      });
    }

    const cfg = guildConfig(guild.id);
    const modalId = interaction.customId;

    // ADICIONAR MEMBRO AO TICKET
    if (modalId === "zenith_add_member_modal") {
      if (
        !isTicketChannel(interaction.channel) ||
        (!hasAdministratorPermission(interaction) &&
         !hasZenithAdminRole(interaction))
      ) {
        return replySafe(interaction, {
          content: "❌ Você não tem permissão para fazer isso.",
          ephemeral: true
        });
      }

      const userId = interaction.fields.getTextInputValue("member_id").trim();
      const member = await guild.members.fetch(userId).catch(() => null);

      if (!member) {
        return replySafe(interaction, {
          content: "❌ Não encontrei esse membro no servidor.",
          ephemeral: true
        });
      }

      await interaction.channel.permissionOverwrites.edit(member.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      });

      return replySafe(interaction, {
        content: `✅ ${member} foi adicionado ao ticket.`,
        ephemeral: false
      });
    }

    // REMOVER MEMBRO DO TICKET
    if (modalId === "zenith_remove_member_modal") {
      if (
        !isTicketChannel(interaction.channel) ||
        (!hasAdministratorPermission(interaction) &&
         !hasZenithAdminRole(interaction))
      ) {
        return replySafe(interaction, {
          content: "❌ Você não tem permissão para fazer isso.",
          ephemeral: true
        });
      }

      const userId = interaction.fields.getTextInputValue("member_id").trim();
      const member = await guild.members.fetch(userId).catch(() => null);

      if (!member) {
        return replySafe(interaction, {
          content: "❌ Não encontrei esse membro no servidor.",
          ephemeral: true
        });
      }

      await interaction.channel.permissionOverwrites.delete(member.id);

      return replySafe(interaction, {
        content: `✅ ${member} foi removido do ticket.`,
        ephemeral: false
      });
    }

    // CONFIGURAR RESPONSÁVEL DO ZENITH
    if (modalId === "config_owner_modal") {
      if (!canManageZenith(interaction)) {
        return replySafe(interaction, {
          content: "❌ Você não tem permissão para alterar essa configuração.",
          ephemeral: true
        });
      }

      const ownerId = interaction.fields.getTextInputValue("owner_id").trim();

      if (!/^\d{17,20}$/.test(ownerId)) {
        return replySafe(interaction, {
          content: "❌ Informe um ID de usuário válido do Discord.",
          ephemeral: true
        });
      }

      cfg.zenithOwner = ownerId;
      saveDB();

      return replySafe(interaction, {
        content: `✅ Responsável do Zenith definido para <@${ownerId}>.`,
        ephemeral: true
      });
    }

    // CONFIGURAR CANAIS E CATEGORIA
    const configFields = {
      zenith_config_logs_modal: {
        key: "logs",
        label: "canal de logs"
      },
      zenith_config_category_modal: {
        key: "ticketCategory",
        label: "categoria dos tickets"
      },
      zenith_config_feedback_modal: {
        key: "feedbackChannel",
        label: "canal de avaliações"
      }
    };

    const config = configFields[modalId];

    if (config) {
      if (!canManageZenith(interaction)) {
        return replySafe(interaction, {
          content: "❌ Você não tem permissão para alterar essa configuração.",
          ephemeral: true
        });
      }

      const channelId = interaction.fields
        .getTextInputValue("channel_id")
        .trim();

      const channel = await guild.channels.fetch(channelId).catch(() => null);

      if (!channel) {
        return replySafe(interaction, {
          content: "❌ Não encontrei esse canal ou categoria.",
          ephemeral: true
        });
      }

      if (config.key === "ticketCategory" && channel.type !== 4) {
        return replySafe(interaction, {
          content: "❌ Informe o ID de uma categoria do servidor.",
          ephemeral: true
        });
      }

      if (config.key !== "ticketCategory" && !channel.isTextBased()) {
        return replySafe(interaction, {
          content: "❌ Selecione um canal de texto válido.",
          ephemeral: true
        });
      }

      cfg[config.key] = channel.id;
      saveDB();

      return replySafe(interaction, {
        content: `✅ ${config.label} configurado: ${channel}.`,
        ephemeral: true
      });
    }
  } catch (error) {
    console.error("[ZENITH] Erro ao processar modal:", error);

    return replySafe(interaction, {
      content: "❌ Ocorreu um erro ao processar o formulário.",
      ephemeral: true
    }).catch(() => {});
  }
});

/* ===============================
   EXECUÇÃO DOS COMANDOS
=============================== */

async function executeTicket(interaction) {
  if (!canManageZenith(interaction)) {
    return replySafe(interaction, {
      content: "❌ Você não tem permissão para configurar os tickets.",
      ephemeral: true
    });
  }

  const cfg = guildConfig(interaction.guild.id);
  const sub = interaction.options.getSubcommand(false);

  if (sub === "painel" || !sub) {
    const channel =
      interaction.options.getChannel("canal") ||
      interaction.channel;

    if (!channel || !channel.isTextBased()) {
      return replySafe(interaction, {
        content: "❌ Escolha um canal de texto válido.",
        ephemeral: true
      });
    }

    cfg.ticketPanelChannel = channel.id;
    saveDB();

    const panel = buildTicketPanel(interaction.guild.id);
    await channel.send(panel);

    return replySafe(interaction, {
      content: `✅ Painel de tickets enviado em ${channel}.`,
      ephemeral: true
    });
  }

  if (sub === "categoria") {
    const category = interaction.options.getChannel("canal");

    if (!category || category.type !== 4) {
      return replySafe(interaction, {
        content: "❌ Selecione uma categoria válida.",
        ephemeral: true
      });
    }

    cfg.ticketCategory = category.id;
    saveDB();

    return replySafe(interaction, {
      content: `✅ Categoria dos tickets definida para **${category.name}**.`,
      ephemeral: true
    });
  }

  return replySafe(interaction, {
    content: "❌ Subcomando de ticket desconhecido.",
    ephemeral: true
  });
}

async function executeSecurity(interaction) {
  if (!canManageZenith(interaction)) {
    return replySafe(interaction, {
      content: "❌ Você não tem permissão para configurar a segurança.",
      ephemeral: true
    });
  }

  const cfg = guildConfig(interaction.guild.id);
  const sub = interaction.options.getSubcommand(false);
  const enabled = interaction.options.getBoolean("ativar");

  if (sub === "antiraid") {
    cfg.antiraid.enabled = enabled ?? !cfg.antiraid.enabled;
  } else if (sub === "antispam") {
    cfg.antispam.enabled = enabled ?? !cfg.antispam.enabled;
  } else if (sub === "botprotection") {
    cfg.botProtection.enabled =
      enabled ?? !cfg.botProtection.enabled;
  } else {
    return replySafe(interaction, {
      content: "❌ Subcomando de segurança desconhecido.",
      ephemeral: true
    });
  }

  saveDB();

  return replySafe(interaction, {
    content:
      `✅ Configuração atualizada.\n` +
      `Antiraid: **${cfg.antiraid.enabled ? "Ativado" : "Desativado"}**\n` +
      `Antispam: **${cfg.antispam.enabled ? "Ativado" : "Desativado"}**\n` +
      `Proteção contra bots: **${cfg.botProtection.enabled ? "Ativada" : "Desativada"}**`,
    ephemeral: true
  });
}

async function executeBlacklist(interaction) {
  if (!canManageZenith(interaction)) {
    return replySafe(interaction, {
      content: "❌ Você não tem permissão para gerenciar a blacklist.",
      ephemeral: true
    });
  }

  const cfg = guildConfig(interaction.guild.id);
  const sub = interaction.options.getSubcommand(false);

  if (sub === "listar") {
    const entries = cfg.blacklist || [];

    return replySafe(interaction, {
      content: entries.length
        ? entries.map(entry =>
            `• ${typeof entry === "string" ? entry : entry.id}`
          ).join("\n").slice(0, 1900)
        : "A blacklist está vazia.",
      ephemeral: true
    });
  }

  if (sub === "adicionar") {
    const user = interaction.options.getUser("usuario");
    if (!user) {
      return replySafe(interaction, {
        content: "❌ Informe um usuário.",
        ephemeral: true
      });
    }

    addToBlacklist(
      interaction.guild.id,
      user.id,
      "Adicionado manualmente"
    );

    return replySafe(interaction, {
      content: `✅ ${user.tag} foi adicionado à blacklist.`,
      ephemeral: true
    });
  }

  if (sub === "remover") {
    const user = interaction.options.getUser("usuario");
    if (!user) {
      return replySafe(interaction, {
        content: "❌ Informe um usuário.",
        ephemeral: true
      });
    }

    cfg.blacklist = (cfg.blacklist || []).filter(entry =>
      (typeof entry === "string" ? entry : entry.id) !== user.id
    );

    saveDB();

    return replySafe(interaction, {
      content: `✅ ${user.tag} foi removido da blacklist.`,
      ephemeral: true
    });
  }

  return replySafe(interaction, {
    content: "❌ Subcomando de blacklist desconhecido.",
    ephemeral: true
  });
}

async function executeWhitelist(interaction) {
  if (!canManageZenith(interaction)) {
    return replySafe(interaction, {
      content: "❌ Você não tem permissão para gerenciar a whitelist.",
      ephemeral: true
    });
  }

  const cfg = guildConfig(interaction.guild.id);
  const sub = interaction.options.getSubcommand(false);

  if (sub === "listar") {
    const entries = cfg.whitelist || [];

    return replySafe(interaction, {
      content: entries.length
        ? entries.map(id => `• ${id}`).join("\n").slice(0, 1900)
        : "A whitelist está vazia.",
      ephemeral: true
    });
  }

  const user = interaction.options.getUser("usuario");

  if (!user) {
    return replySafe(interaction, {
      content: "❌ Informe um usuário.",
      ephemeral: true
    });
  }

  if (sub === "adicionar") {
    if (!cfg.whitelist.includes(user.id)) {
      cfg.whitelist.push(user.id);
    }

    cfg.blacklist = (cfg.blacklist || []).filter(entry =>
      (typeof entry === "string" ? entry : entry.id) !== user.id
    );

    saveDB();

    return replySafe(interaction, {
      content: `✅ ${user.tag} foi adicionado à whitelist.`,
      ephemeral: true
    });
  }

  if (sub === "remover") {
    cfg.whitelist = cfg.whitelist.filter(id => id !== user.id);
    saveDB();

    return replySafe(interaction, {
      content: `✅ ${user.tag} foi removido da whitelist.`,
      ephemeral: true
    });
  }

  return replySafe(interaction, {
    content: "❌ Subcomando de whitelist desconhecido.",
    ephemeral: true
  });
}

/* ===============================
   LOGS, LOCKDOWN E MODERAÇÃO
=============================== */

async function executeLogs(interaction) {
  if (!canManageZenith(interaction)) {
    return replySafe(interaction, {
      content: "❌ Você não tem permissão para configurar os logs.",
      ephemeral: true
    });
  }

  const cfg = guildConfig(interaction.guild.id);
  const channel = interaction.options.getChannel("canal");

  if (!channel || !channel.isTextBased()) {
    return replySafe(interaction, {
      content: "❌ Informe um canal de texto válido.",
      ephemeral: true
    });
  }

  cfg.logs = channel.id;
  saveDB();

  await sendLog(
    interaction.guild,
    "⚙️ Canal de logs configurado",
    `Os registros do Zenith serão enviados para ${channel}.`
  );

  return replySafe(interaction, {
    content: `✅ Canal de logs definido para ${channel}.`,
    ephemeral: true
  });
}

async function executeLockdown(interaction) {
  if (!canManageZenith(interaction)) {
    return replySafe(interaction, {
      content: "❌ Você não tem permissão para usar o lockdown.",
      ephemeral: true
    });
  }

  const cfg = guildConfig(interaction.guild.id);
  const enabled = interaction.options.getBoolean("ativar");

  cfg.lockdown = enabled ?? !cfg.lockdown;
  saveDB();

  const everyone = interaction.guild.roles.everyone;
  let changed = 0;
  let failed = 0;

  for (const channel of interaction.guild.channels.cache.values()) {
    if (!channel.isTextBased() || !channel.permissionOverwrites) continue;

    try {
      if (cfg.lockdown) {
        await channel.permissionOverwrites.edit(everyone, {
          SendMessages: false
        });
      } else {
        await channel.permissionOverwrites.edit(everyone, {
          SendMessages: null
        });
      }

      changed++;
    } catch {
      failed++;
    }
  }

  await sendLog(
    interaction.guild,
    cfg.lockdown ? "🔒 Lockdown ativado" : "🔓 Lockdown desativado",
    `Responsável: ${interaction.user.tag}\nCanais alterados: ${changed}\nFalhas: ${failed}`
  );

  return replySafe(interaction, {
    content:
      `${cfg.lockdown ? "🔒 Lockdown ativado" : "🔓 Lockdown desativado"}.\n` +
      `Canais alterados: **${changed}**\n` +
      `Falhas: **${failed}**`,
    ephemeral: true
  });
}

async function executeModeration(interaction) {
  if (!canManageZenith(interaction)) {
    return replySafe(interaction, {
      content: "❌ Você não tem permissão para usar este comando.",
      ephemeral: true
    });
  }

  const command = interaction.commandName;
  const target = interaction.options.getUser("usuario");
  const reason =
    interaction.options.getString("motivo") || "Motivo não informado";

  if (!target) {
    return replySafe(interaction, {
      content: "❌ Informe o usuário que deseja moderar.",
      ephemeral: true
    });
  }

  if (target.id === interaction.user.id) {
    return replySafe(interaction, {
      content: "❌ Você não pode aplicar esta ação em si mesmo.",
      ephemeral: true
    });
  }

  if (target.id === interaction.client.user.id) {
    return replySafe(interaction, {
      content: "❌ Não posso aplicar esta ação em mim mesmo.",
      ephemeral: true
    });
  }

  const member = await interaction.guild.members
    .fetch(target.id)
    .catch(() => null);

  if (!member) {
    return replySafe(interaction, {
      content: "❌ Esse usuário não está no servidor.",
      ephemeral: true
    });
  }

  if (
    member.id === interaction.guild.ownerId ||
    member.roles.highest.position >=
      interaction.member.roles.highest.position
  ) {
    return replySafe(interaction, {
      content: "❌ Você não pode moderar esse membro devido à hierarquia de cargos.",
      ephemeral: true
    });
  }

  if (command === "ban") {
    if (!member.bannable) {
      return replySafe(interaction, {
        content: "❌ Não consigo banir esse usuário. Verifique as permissões e a hierarquia do bot.",
        ephemeral: true
      });
    }

    await member.ban({ reason: `${reason} | Por: ${interaction.user.tag}` });

    await sendLog(
      interaction.guild,
      "🔨 Usuário banido",
      `Usuário: ${target.tag} (${target.id})\nModerador: ${interaction.user.tag}\nMotivo: ${reason}`
    );

    return replySafe(interaction, {
      content: `🔨 **${target.tag}** foi banido.\nMotivo: ${reason}`,
      ephemeral: true
    });
  }

  if (command === "kick") {
    if (!member.kickable) {
      return replySafe(interaction, {
        content: "❌ Não consigo expulsar esse usuário. Verifique as permissões e a hierarquia do bot.",
        ephemeral: true
      });
    }

    await member.kick(`${reason} | Por: ${interaction.user.tag}`);

    await sendLog(
      interaction.guild,
      "👢 Usuário expulso",
      `Usuário: ${target.tag} (${target.id})\nModerador: ${interaction.user.tag}\nMotivo: ${reason}`
    );

    return replySafe(interaction, {
      content: `👢 **${target.tag}** foi expulso.\nMotivo: ${reason}`,
      ephemeral: true
    });
  }

  if (command === "warn") {
    const cfg = guildConfig(interaction.guild.id);

    cfg.warns ??= {};
    cfg.warns[target.id] ??= [];

    cfg.warns[target.id].push({
      moderatorId: interaction.user.id,
      reason,
      date: new Date().toISOString()
    });

    saveDB();

    await sendLog(
      interaction.guild,
      "⚠️ Advertência aplicada",
      `Usuário: ${target.tag} (${target.id})\nModerador: ${interaction.user.tag}\nMotivo: ${reason}\nTotal de advertências: ${cfg.warns[target.id].length}`
    );

    return replySafe(interaction, {
      content:
        `⚠️ **${target.tag}** recebeu uma advertência.\n` +
        `Motivo: ${reason}\n` +
        `Total de advertências: **${cfg.warns[target.id].length}**`,
      ephemeral: true
    });
  }

  return replySafe(interaction, {
    content: "❌ Comando de moderação não reconhecido.",
    ephemeral: true
  });
}

/* ===============================
   EVENTOS FINAIS E INICIALIZAÇÃO
=============================== */

// Atualiza as informações quando o bot entrar em um servidor
client.on("guildCreate", async guild => {
  console.log(`[ZENITH] Adicionado ao servidor: ${guild.name} (${guild.id})`);

  try {
    await updateServerInfo(client);
  } catch (error) {
    console.error("[ZENITH] Erro ao atualizar informações:", error);
  }
});

// Atualiza as informações quando um servidor mudar
client.on("guildUpdate", async () => {
  try {
    await updateServerInfo(client);
  } catch (error) {
    console.error("[ZENITH] Erro ao atualizar informações:", error);
  }
});

// Inicialização do bot
client.once("ready", async () => {
  console.log("==================================");
  console.log(`[ZENITH] Online como ${client.user.tag}`);
  console.log(`[ZENITH] Servidores: ${client.guilds.cache.size}`);
  console.log("==================================");

  // Registra os comandos em cada servidor
  for (const guild of client.guilds.cache.values()) {
    try {
      const commandData = commands.map(command =>
        typeof command.toJSON === "function"
          ? command.toJSON()
          : command
      );

      await guild.commands.set(commandData);

      console.log(
        `[ZENITH] ${commandData.length} comandos registrados em ${guild.name}`
      );
    } catch (error) {
      console.error(
        `[ZENITH] Erro ao registrar comandos em ${guild.name}:`,
        error.message
      );
    }
  }

  try {
    await updateServerInfo(client);
  } catch (error) {
    console.error("[ZENITH] Erro ao atualizar informações:", error);
  }
});

// Servidor HTTP para hospedagem e health check
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8"
    });

    return res.end(JSON.stringify({
      status: "online",
      bot: client.user?.tag || null,
      uptime: process.uptime()
    }));
  }

  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8"
  });

  res.end("Zenith online");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[ZENITH] Servidor HTTP ativo na porta ${PORT}`);
});

// Login
const token = process.env.DISCORD_TOKEN || process.env.TOKEN;

if (!token) {
  console.error(
    "[ZENITH] ERRO: configure DISCORD_TOKEN ou TOKEN nas variáveis de ambiente."
  );
} else {
  client.login(token).catch(error => {
    console.error("[ZENITH] Falha ao conectar o bot:", error);
  });
}
