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

console.log(
"[ZENITH] Comandos carregados:",
commands.map(command => command.name)
);

const {
updateServerInfo
} = require("./events/updateInfo");

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

const data = JSON.parse(  
  fs.readFileSync(DB_FILE, "utf8")  
);  

if (!data || typeof data !== "object") {  
  return { guilds: {} };  
}  

if (!data.guilds || typeof data.guilds !== "object") {  
  data.guilds = {};  
}  

return data;

} catch {
return { guilds: {} };
}
}

let db = loadDB();

function saveDB() {
fs.writeFileSync(
DB_FILE,
JSON.stringify(db, null, 2)
);
}

/* =========================================
CONFIGURAÇÃO PADRÃO
========================================= */

function guildConfig(guild) {

const id = String(guild.id);

if (!db.guilds[id]) {
db.guilds[id] = {};
}

const cfg = db.guilds[id];

if (!Array.isArray(cfg.blacklist))
cfg.blacklist = [];

if (!Array.isArray(cfg.whitelist))
cfg.whitelist = [];

if (!Array.isArray(cfg.feedbacks))
cfg.feedbacks = [];

if (!cfg.warns)
cfg.warns = {};

if (typeof cfg.zenithOwner === "undefined")
cfg.zenithOwner = null;

if (typeof cfg.blacklist === "undefined")
cfg.blacklist = [];

if (typeof cfg.whitelist === "undefined")
cfg.whitelist = [];

if (typeof cfg.logs === "undefined")
cfg.logs = null;

if (typeof cfg.feedbackChannel === "undefined")
cfg.feedbackChannel = null;

if (typeof cfg.ticketCategory === "undefined")
cfg.ticketCategory = null;

if (typeof cfg.ticketPanelChannel === "undefined")
cfg.ticketPanelChannel = null;

if (typeof cfg.antiraid !== "boolean")
cfg.antiraid = true;

if (typeof cfg.antispam !== "boolean")
cfg.antispam = true;

if (typeof cfg.botProtection !== "boolean")
cfg.botProtection = true;

if (typeof cfg.lockdown !== "boolean")
cfg.lockdown = false;

if (!cfg.ticketPanel)
cfg.ticketPanel = {};

if (!cfg.ticketPanel.title)
cfg.ticketPanel.title = "🎫 Central de Atendimento";

if (!cfg.ticketPanel.description)
cfg.ticketPanel.description =
"Clique no botão abaixo para abrir um atendimento.";

if (!cfg.ticketPanel.color)
cfg.ticketPanel.color = "#5865F2";

if (!cfg.ticketPanel.footer)
cfg.ticketPanel.footer = "Zenith • Atendimento";

if (typeof cfg.ticketPanel.image === "undefined")
cfg.ticketPanel.image = null;

if (typeof cfg.ticketPanel.thumbnail === "undefined")
cfg.ticketPanel.thumbnail = null;

if (!Array.isArray(cfg.whitelist)) {
cfg.whitelist = [];
}

saveDB();

return cfg;
}

/* =========================================
DONO DO ZENITH
========================================= */

function isZenithOwner(interaction) {

if (!interaction.guild) return false;

const cfg = guildConfig(interaction.guild);

// Proprietário configurado do Zenith
if (
cfg.zenithOwner &&
interaction.user.id === cfg.zenithOwner
) {
return true;
}

// Dono do servidor
if (
interaction.guild.ownerId ===
interaction.user.id
) {
return true;
}

// Administrador do servidor
if (
interaction.member &&
interaction.member.permissions.has(
PermissionFlagsBits.Administrator
)
) {
return true;
}

return false;
}

/* =========================================
CLIENT
========================================= */

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

/* =========================================
LOGS
========================================= */

async function sendLog(
guild,
title,
description,
color = 0x5865F2
) {

const cfg = guildConfig(guild);

if (!cfg.logs) return;

const channel = guild.channels.cache.get(cfg.logs);

if (!channel || !channel.isTextBased())
return;

const embed = new EmbedBuilder()
.setTitle(title)
.setDescription(description)
.setColor(color)
.setTimestamp();

try {
await channel.send({
embeds: [embed]
});
} catch {}
}

/* =========================================
PUNIÇÃO
========================================= */

async function punish(
guild,
userId,
reason
) {

const cfg = guildConfig(guild);

if (isProtected(guild, userId))
return false;

if (!cfg.blacklist.includes(userId)) {
cfg.blacklist.push(userId);
saveDB();
}

try {
await guild.members.ban(userId, {
reason: `Zenith Security: ${reason}`
});
} catch {}

await sendLog(
  guild,
  "🚨 AMEAÇA BLOQUEADA",
  `**Usuário:** <@${userId}>\n` +
  `**ID:** ${userId}\n` +
  `**Motivo:** ${reason}\n\n` +
  `☠️ Blacklist permanente\n` +
  `🔨 Ban aplicado`,
  0xED4245
);

return true;
}

/* =========================================
ANTI-SPAM
========================================= */

const spamMap = new Map();

client.on(
"messageCreate",
async message => {

if (!message.guild || message.author.bot)  
  return;  

const cfg = guildConfig(message.guild);  

if (!cfg.antispam)  
  return;  

if (  
  isProtected(  
    message.guild,  
    message.author.id  
  )  
) return;  

const key =  
  `${message.guild.id}:${message.author.id}`;  

if (!spamMap.has(key))  
  spamMap.set(key, []);  

const arr = spamMap.get(key);  
const now = Date.now();  

arr.push(now);  

while (  
  arr.length &&  
  now - arr[0] > 5000  
) {  
  arr.shift();  
}  

if (arr.length >= 10) {  

  spamMap.delete(key);  

  try {  
    await message.member.timeout(  
      60 * 1000,  
      "Zenith Anti-Spam"  
    );  
  } catch {}  

  await sendLog(  
    message.guild,  
    "🚨 ANTI-SPAM",  
    `**Usuário:** <@${message.author.id}>\n` +  
    `10 mensagens em poucos segundos.\n` +  
    `**Ação:** Timeout de 1 minuto.`,  
    0xFEE75C  
  );  
}

}
);

/* =========================================
ANTI-RAID
========================================= */

const raidMap = new Map();

function raidAction(
guild,
userId,
type
) {

const key =
`${guild.id}:${userId}:${type}`;

if (!raidMap.has(key))
raidMap.set(key, []);

const arr = raidMap.get(key);
const now = Date.now();

arr.push(now);

while (
arr.length &&
now - arr[0] > 10000
) {
arr.shift();
}

return arr.length;
}

async function detectAudit(
guild,
action,
targetId,
type
) {

const cfg = guildConfig(guild);

if (!cfg.antiraid)
return;

try {

const logs =  
  await guild.fetchAuditLogs({  
    type: action,  
    limit: 10  
  });  

const entry =  
  logs.entries.find(e => {  

    if (!e.executor)  
      return false;  

    if (  
      targetId &&  
      e.target?.id !== targetId  
    )  
      return false;  

    return (  
      Date.now() -  
      e.createdTimestamp <  
      10000  
    );  
  });  

if (!entry)  
  return;  

const userId =  
  entry.executor.id;  

if (isProtected(guild, userId))  
  return;  

const amount =  
  raidAction(  
    guild,  
    userId,  
    type  
  );  

if (amount >= 3) {  

  await punish(  
    guild,  
    userId,  
    type  
  );  
}

} catch {}
}

client.on(
"channelCreate",
channel => {

if (!channel.guild)  
  return;  

detectAudit(  
  channel.guild,  
  AuditLogEvent.ChannelCreate,  
  channel.id,  
  "criação rápida de canais"  
);

}
);

client.on(
"channelDelete",
channel => {

if (!channel.guild)  
  return;  

detectAudit(  
  channel.guild,  
  AuditLogEvent.ChannelDelete,  
  channel.id,  
  "exclusão rápida de canais"  
);

}
);

client.on(
"channelUpdate",
(oldChannel, newChannel) => {

if (!newChannel.guild)  
  return;  

if (  
  oldChannel.name !==  
  newChannel.name  
) {  

  detectAudit(  
    newChannel.guild,  
    AuditLogEvent.ChannelUpdate,  
    newChannel.id,  
    "renomeação rápida de canais"  
  );  
}

}
);

client.on(
"roleCreate",
role => {

detectAudit(  
  role.guild,  
  AuditLogEvent.RoleCreate,  
  role.id,  
  "criação rápida de cargos"  
);

}
);

client.on(
"roleDelete",
role => {

detectAudit(  
  role.guild,  
  AuditLogEvent.RoleDelete,  
  role.id,  
  "exclusão rápida de cargos"  
);

}
);

/* =========================================
ANTI-BOT
========================================= */

client.on(
"guildMemberAdd",
async member => {

const cfg =  
  guildConfig(member.guild);  

if (  
  cfg.blacklist.includes(member.id)  
) {  

  try {  
    await member.ban({  
      reason:  
        "Zenith: blacklist permanente"  
    });  
  } catch {}  

  return;  
}  

if (  
  !member.user.bot ||  
  !cfg.botProtection  
)  
  return;  

setTimeout(  
  async () => {  

    try {  

      const logs =  
        await member.guild.fetchAuditLogs({  
          type: AuditLogEvent.BotAdd,  
          limit: 10  
        });  

      const entry =  
        logs.entries.find(e =>  
          e.target?.id === member.id &&  
          Date.now() -  
          e.createdTimestamp <  
          15000  
        );  

      if (  
        !entry ||  
        !entry.executor  
      )  
        return;  

      const executor =  
        entry.executor;  

      if (  
        isProtected(  
          member.guild,  
          executor.id  
        )  
      )  
        return;  

      await punish(  
        member.guild,  
        executor.id,  
        "adicionou um bot não autorizado"  
      );  

      try {  
        await member.ban({  
          reason:  
            "Zenith Anti-Bot"  
        });  
      } catch {}  

    } catch {}  
  },  
  1500  
);

}
);

/* =========================================
EMBED DO PAINEL DE TICKET
========================================= */

function createTicketPanel(cfg) {

const embed =
new EmbedBuilder()
.setTitle(
cfg.ticketPanel.title
)
.setDescription(
cfg.ticketPanel.description
)
.setColor(
cfg.ticketPanel.color ||
"#5865F2"
)
.setFooter({
text:
cfg.ticketPanel.footer ||
"Zenith"
});

if (cfg.ticketPanel.image) {
embed.setImage(
cfg.ticketPanel.image
);
}

if (cfg.ticketPanel.thumbnail) {
embed.setThumbnail(
cfg.ticketPanel.thumbnail
);
}

const row =
new ActionRowBuilder()
.addComponents(

new ButtonBuilder()  
      .setCustomId(  
        "zenith_open_ticket"  
      )  
      .setLabel(  
        "Abrir Ticket"  
      )  
      .setEmoji("🎫")  
      .setStyle(  
        ButtonStyle.Primary  
      )  

  );

return {
embeds: [embed],
components: [row]
};
}

/* =========================================
MENU DE TIPOS DE TICKET
========================================= */

function ticketTypeMenu() {

const menu =
new StringSelectMenuBuilder()
.setCustomId(
"zenith_ticket_type"
)
.setPlaceholder(
"Selecione o tipo de atendimento"
)
.addOptions(
{
label: "Suporte",
description:
"Preciso de ajuda",
value: "suporte",
emoji: "🎫"
},
{
label: "Denúncia",
description:
"Enviar uma denúncia",
value: "denuncia",
emoji: "🚨"
},
{
label: "Dúvida",
description:
"Tenho uma dúvida",
value: "duvida",
emoji: "❓"
},
{
label: "Compras",
description:
"Ajuda com compras",
value: "compra",
emoji: "🛒"
}
);

return new ActionRowBuilder()
.addComponents(menu);
}

/* =========================================
CRIAR TICKET
========================================= */

async function createTicket(
interaction,
type
) {

const guild =
interaction.guild;

const cfg =
guildConfig(guild);

const existing =
guild.channels.cache.find(
c =>
c.type ===
ChannelType.GuildText &&
c.topic ===
ZENITH_TICKET:${interaction.user.id}
);

if (existing) {

return interaction.reply({  
  content:  
    `❌ Você já possui um ticket aberto: ${existing}`,  
  ephemeral: true  
});

}

let category =
cfg.ticketCategory;

if (
category &&
!guild.channels.cache.has(category)
) {
category = null;
}

if (!category) {

const found =  
  guild.channels.cache.find(  
    c =>  
      c.type ===  
        ChannelType.GuildCategory &&  
      c.name  
        .toLowerCase()  
        .includes("ticket")  
  );  

category =  
  found?.id || null;

}

const names = {
suporte: "suporte",
denuncia: "denuncia",
duvida: "duvida",
compra: "compras"
};

const channel =
await guild.channels.create({

name:  
    `ticket-${names[type] || "atendimento"}-${interaction.user.username}`  
      .toLowerCase()  
      .replace(  
        /[^a-z0-9-]/g,  
        ""  
      )  
      .slice(0, 80),  

  type:  
    ChannelType.GuildText,  

  parent:  
    category || undefined,  

  topic:  
    `ZENITH_TICKET:${interaction.user.id}`,  

  permissionOverwrites: [  

    {  
      id:  
        guild.roles.everyone.id,  

      deny: [  
        PermissionFlagsBits.ViewChannel  
      ]  
    },  

    {  
      id:  
        interaction.user.id,  

      allow: [  
        PermissionFlagsBits.ViewChannel,  
        PermissionFlagsBits.SendMessages,  
        PermissionFlagsBits.ReadMessageHistory  
      ]  
    },  

    {  
      id:  
        cfg.zenithOwner ||  
        guild.ownerId,  

      allow: [  
        PermissionFlagsBits.ViewChannel,  
        PermissionFlagsBits.SendMessages,  
        PermissionFlagsBits.ReadMessageHistory  
      ]  
    }  

  ]  
});

const labels = {
suporte: "🎫 Suporte",
denuncia: "🚨 Denúncia",
duvida: "❓ Dúvida",
compra: "🛒 Compras"
};

const embed =
new EmbedBuilder()
.setTitle(
🎫 ${labels[type] || "Atendimento"}
)
.setDescription(
Olá <@${interaction.user.id}>!\n\n +
Explique seu problema com o máximo de detalhes possível.\n\n +
Quando terminar, clique em **Fechar Ticket**.
)
.setColor(0x5865F2)
.setFooter({
text:
"Zenith • Sistema de Tickets"
})
.setTimestamp();

const row =
new ActionRowBuilder()
.addComponents(

new ButtonBuilder()  
      .setCustomId(  
        "zenith_close_ticket"  
      )  
      .setLabel(  
        "Fechar Ticket"  
      )  
      .setEmoji("🔒")  
      .setStyle(  
        ButtonStyle.Danger  
      )  

  );

await channel.send({
content:
<@${interaction.user.id}>,
embeds: [embed],
components: [row]
});

await sendLog(
guild,
"🎫 Ticket aberto",
**Usuário:** <@${interaction.user.id}>\n +
**Tipo:** ${labels[type]}\n +
**Canal:** ${channel}
);

return interaction.reply({
content:
✅ Ticket criado: ${channel},
ephemeral: true
});
}

/* =========================================
FECHAR TICKET
========================================= */

async function closeTicket(
interaction
) {

const channel =
interaction.channel;

const guild =
interaction.guild;

const openerId =
channel.topic?.startsWith(
"ZENITH_TICKET:"
)
? channel.topic.split(":")[1]
: null;

const cfg =
guildConfig(guild);

if (
interaction.user.id !==
cfg.zenithOwner &&
interaction.user.id !==
openerId
) {

return interaction.reply({  
  content:  
    "❌ Apenas o dono do ticket ou o dono do Zenith pode fechá-lo.",  
  ephemeral: true  
});

}

await interaction.reply({
content:
"🔒 Fechando ticket...",
ephemeral: true
});

let messages = [];

try {

let last;  

for (let i = 0; i < 5; i++) {  

  const fetched =  
    await channel.messages.fetch({  
      limit: 100,  
      before: last  
    });  

  if (!fetched.size)  
    break;  

  messages.push(  
    ...fetched.values()  
  );  

  last =  
    fetched.last().id;  

  if (fetched.size < 100)  
    break;  
}

} catch {}

messages.reverse();

const transcript =
messages
.map(
m =>
[${new Date(   m.createdTimestamp   ).toLocaleString("pt-BR")}]  +
${m.author.tag}: ${m.content}
)
.join("\n");

if (openerId) {

try {  

  const user =  
    await client.users.fetch(  
      openerId  
    );  

  const row =  
    new ActionRowBuilder()  
      .addComponents(  

        new ButtonBuilder()  
          .setCustomId(  
            `feedback:${guild.id}:${channel.id}:1`  
          )  
          .setLabel("1 ⭐")  
          .setStyle(  
            ButtonStyle.Secondary  
          ),  

        new ButtonBuilder()  
          .setCustomId(  
            `feedback:${guild.id}:${channel.id}:2`  
          )  
          .setLabel("2 ⭐")  
          .setStyle(  
            ButtonStyle.Secondary  
          ),  

        new ButtonBuilder()  
          .setCustomId(  
            `feedback:${guild.id}:${channel.id}:3`  
          )  
          .setLabel("3 ⭐")  
          .setStyle(  
            ButtonStyle.Primary  
          ),  

        new ButtonBuilder()  
          .setCustomId(  
            `feedback:${guild.id}:${channel.id}:4`  
          )  
          .setLabel("4 ⭐")  
          .setStyle(  
            ButtonStyle.Success  
          ),  

        new ButtonBuilder()  
          .setCustomId(  
            `feedback:${guild.id}:${channel.id}:5`  
          )  
          .setLabel("5 ⭐")  
          .setStyle(  
            ButtonStyle.Success  
          )  

      );  

  await user.send({  

    embeds: [  

      new EmbedBuilder()  
        .setTitle(  
          "⭐ Avalie seu atendimento"  
        )  
        .setDescription(  
          `Seu ticket em **${guild.name}** foi encerrado.\n\n` +  
          `Como foi seu atendimento?`  
        )  
        .setColor(0xFEE75C)  

    ],  

    components: [row]  
  });  

} catch {}

}

await sendLog(
guild,
"🔒 Ticket fechado",
**Usuário:** <@${openerId || "desconhecido"}>\n +
**Fechado por:** <@${interaction.user.id}>\n +
**Canal:** #${channel.name}
);

setTimeout(
async () => {

try {  
    await channel.delete(  
      "Zenith Ticket fechado"  
    );  
  } catch {}  

},  
1500

);
}

/* =========================================
PAINEL CONFIG
========================================= */

function configEmbed(guild) {

const cfg =
guildConfig(guild);

const owner =
cfg.zenithOwner
? <@${cfg.zenithOwner}>
: "❌ Não configurado";

const category =
cfg.ticketCategory
? <#${cfg.ticketCategory}>
: "❌ Não configurada";

const logs =
cfg.logs
? <#${cfg.logs}>
: "❌ Não configurado";

const feedback =
cfg.feedbackChannel
? <#${cfg.feedbackChannel}>
: "❌ Não configurado";

const panel =
cfg.ticketPanelChannel
? <#${cfg.ticketPanelChannel}>
: "❌ Não configurado";

return new EmbedBuilder()
.setTitle("⚙️ Zenith • Configuração")
.setDescription(
"Configure o Zenith através dos botões abaixo."
)
.addFields(

{  
    name: "👑 Dono do Zenith",  
    value: owner,  
    inline: true  
  },  

  {  
    name: "🎫 Categoria",  
    value: category,  
    inline: true  
  },  

  {  
    name: "📋 Logs",  
    value: logs,  
    inline: true  
  },  

  {  
    name: "⭐ Avaliações",  
    value: feedback,  
    inline: true  
  },  

  {  
    name: "🎟️ Painel",  
    value: panel,  
    inline: true  
  },  

  {  
    name: "🛡️ Anti-Raid",  
    value:  
      cfg.antiraid  
        ? "🟢 ATIVO"  
        : "🔴 DESATIVADO",  
    inline: true  
  },  

  {  
    name: "💬 Anti-Spam",  
    value:  
      cfg.antispam  
        ? "🟢 ATIVO"  
        : "🔴 DESATIVADO",  
    inline: true  
  },  

  {  
    name: "🤖 Anti-Bot",  
    value:  
      cfg.botProtection  
        ? "🟢 ATIVO"  
        : "🔴 DESATIVADO",  
    inline: true  
  }  

)  
.setColor(0x5865F2)  
.setFooter({  
  text:  
    "Zenith Security • Configuração"  
})  
.setTimestamp();

}

function configButtons() {

return [

new ActionRowBuilder()  
  .addComponents(  

    new ButtonBuilder()  
      .setCustomId(  
        "config_owner"  
      )  
      .setLabel("Dono")  
      .setEmoji("👑")  
      .setStyle(  
        ButtonStyle.Primary  
      ),  

    new ButtonBuilder()  
      .setCustomId(  
        "config_category"  
      )  
      .setLabel("Categoria")  
      .setEmoji("🎫")  
      .setStyle(  
        ButtonStyle.Primary  
      ),  

    new ButtonBuilder()  
      .setCustomId(  
        "config_logs"  
      )  
      .setLabel("Logs")  
      .setEmoji("📋")  
      .setStyle(  
        ButtonStyle.Secondary  
      ),  

    new ButtonBuilder()  
      .setCustomId(  
        "config_feedback"  
      )  
      .setLabel("Avaliações")  
      .setEmoji("⭐")  
      .setStyle(  
        ButtonStyle.Secondary  
      ),  

    new ButtonBuilder()  
      .setCustomId(  
        "config_panel"  
      )  
      .setLabel("Canal do Painel")  
      .setEmoji("🎟️")  
      .setStyle(  
        ButtonStyle.Secondary  
      )  

  ),  

new ActionRowBuilder()  
  .addComponents(  

    new ButtonBuilder()  
      .setCustomId(  
        "config_security"  
      )  
      .setLabel("Segurança")  
      .setEmoji("🛡️")  
      .setStyle(  
        ButtonStyle.Danger  
      ),  

    new ButtonBuilder()  
      .setCustomId(  
        "config_refresh"  
      )  
      .setLabel("Atualizar")  
      .setEmoji("🔄")  
      .setStyle(  
        ButtonStyle.Success  
      )  

  )

];
}

/* =========================================
INTERAÇÕES
========================================= */

client.on(
"interactionCreate",
async interaction => {

/* =========================================  
   ⭐ CONFIGURAÇÃO DO CANAL DE AVALIAÇÕES  
   ========================================= */  

if (  
  interaction.isChannelSelectMenu() &&  
  interaction.customId === "config_feedback_select"  
) {  

  try {  

    const guild = interaction.guild;  

    if (!guild) {  
      return interaction.reply({  
        content: "❌ Essa ação só pode ser usada em um servidor.",  
        ephemeral: true  
      });  
    }  

    const cfg = guildConfig(guild);  

    const channelId =  
      interaction.values &&  
      interaction.values[0];  

    if (!channelId) {  
      return interaction.reply({  
        content: "❌ Nenhum canal foi selecionado.",  
        ephemeral: true  
      });  
    }  

    const channel =  
      guild.channels.cache.get(channelId);  

    if (!channel) {  
      return interaction.reply({  
        content: "❌ Não encontrei o canal selecionado.",  
        ephemeral: true  
      });  
    }  

    cfg.feedbackChannel = channel.id;  

    saveDB();  

    console.log(  
      `[CONFIG] Canal de avaliações definido: ${channel.id}`  
    );  

    return interaction.update({  
      content:  
        `⭐ **Canal de avaliações configurado!**\n\n` +  
        `As avaliações dos tickets serão enviadas em ${channel}.`,  
      components: []  
    });  

  } catch (error) {  

    console.error(  
      "[FEEDBACK CHANNEL ERROR]",  
      error  
    );  

    if (  
      !interaction.replied &&  
      !interaction.deferred  
    ) {  
      return interaction.reply({  
        content:  
          "❌ Erro ao configurar o canal de avaliações.",  
        ephemeral: true  
      });  
    }  
  }  
}  



try {  

  /* ===============================  
     MENU ÚNICO DE TICKETS  
  =============================== */  

  if (  
    interaction.isButton() &&  
    interaction.customId ===  
      "zenith_open_ticket"  
  ) {  

    return interaction.reply({  
      content:  
        "🎫 **Escolha o tipo de atendimento:**",  
      components: [  
        ticketTypeMenu()  
      ],  
      ephemeral: true  
    });  
  }  

  /* ===============================  
     ESCOLHA DO TIPO  
  =============================== */  

  if (  
    interaction.isStringSelectMenu() &&  
    interaction.customId ===  
      "zenith_ticket_type"  
  ) {  

    const type =  
      interaction.values[0];  

    return createTicket(  
      interaction,  
      type  
    );  
  }  

  /* ===============================  
     FECHAR  
  =============================== */  

  if (  
    interaction.isButton() &&  
    interaction.customId ===  
      "zenith_close_ticket"  
  ) {  

    return closeTicket(  
      interaction  
    );  
  }  

  /* ===============================  
     FEEDBACK  
  =============================== */  

  if (  
    interaction.isButton() &&  
    interaction.customId.startsWith(  
      "feedback:"  
    )  
  ) {  

    const parts =  
      interaction.customId.split(":");  

    const guildId = parts[1];  
    const ticketId = parts[2];  
    const rating =  
      Number(parts[3]);  

    const guild =  
      client.guilds.cache.get(  
        guildId  
      );  

    if (!guild) {  

      return interaction.reply({  
        content:  
          "❌ Servidor não encontrado.",  
        ephemeral: true  
      });  
    }  

    const cfg =  
      guildConfig(guild);  

    cfg.feedbacks.push({  
      userId:  
        interaction.user.id,  
      ticketId,  
      rating,  
      date:  
        new Date().toISOString()  
    });  

    saveDB();  

    const feedbackChannel =  
      cfg.feedbackChannel  
        ? guild.channels.cache.get(  
            cfg.feedbackChannel  
          )  
        : null;  

    if (  
      feedbackChannel &&  
      feedbackChannel.isTextBased()  
    ) {  

      const feedbackEmbed =  
        new EmbedBuilder()  
          .setTitle(  
            "⭐ Nova avaliação de atendimento"  
          )  
          .setDescription(  
            `**Cliente:** <@${interaction.user.id}>\n` +  
            `**Nota:** ${"⭐".repeat(rating)}\n` +  
            `**Avaliação:** ${rating}/5\n\n` +  
            `**Ticket:** \`${ticketId}\``  
          )  
          .setColor(  
            rating >= 4  
              ? 0x57F287  
              : rating === 3  
                ? 0xFEE75C  
                : 0xED4245  
          )  
          .setTimestamp();  

      await feedbackChannel.send({  
        embeds: [feedbackEmbed]  
      });  
    }  

    return interaction.update({  
      content:  
        `✅ Obrigado pelo feedback!\n\n` +  
        `Você deu **${rating}/5 ⭐**.`,  
      embeds: [],  
      components: []  
    });  
  }  

  /* ===============================  
     COMANDOS  
  =============================== */  

  if (  
    interaction.isChatInputCommand()  
  ) {  

    if (!interaction.guild) {  

      return interaction.reply({  
        content:  
          "❌ Use este comando dentro de um servidor.",  
        ephemeral: true  
      });  
    }  

    const guild =  
      interaction.guild;  

    const cfg =  
      guildConfig(guild);  

    /* PRIMEIRO CONFIG */  

    if (  
      interaction.commandName ===  
      "config"  
    ) {  

      if (!cfg.zenithOwner) {  

        return interaction.reply({  
          embeds: [  
            new EmbedBuilder()  
              .setTitle(  
                "👑 Configurar Zenith"  
              )  
              .setDescription(  
                "O Zenith ainda não possui um proprietário configurado.\n\n" +  
                "Somente o **dono atual do servidor Discord** pode fazer a primeira configuração."  
              )  
              .setColor(  
                0xFEE75C  
              )  
          ],  
          components: [  
            new ActionRowBuilder()  
              .addComponents(  

                new ButtonBuilder()  
                  .setCustomId(  
                    "config_first_owner"  
                  )  
                  .setLabel(  
                    "Configurar como dono"  
                  )  
                  .setEmoji("👑")  
                  .setStyle(  
                    ButtonStyle.Success  
                  )  

              )  
          ],  
          ephemeral: true  
        });  
      }  

      if (!isZenithOwner(interaction)) {  

        return interaction.reply({  
          content:  
            "🔒 Você não é o proprietário configurado do Zenith.",  
          ephemeral: true  
        });  
      }  

      return interaction.reply({  
        embeds: [  
          configEmbed(guild)  
        ],  
        components:  
          configButtons(),  
        ephemeral: true  
      });  
    }  

    /* TODOS OS OUTROS COMANDOS */  

    if (!isZenithOwner(interaction)) {  

      return interaction.reply({  
        content:  
          "🔒 Apenas o proprietário configurado do Zenith pode usar este comando.",  
        ephemeral: true  
      });  
    }  

    /* SETUP */  

    if (  
      interaction.commandName ===  
      "setup"  
    ) {  

      let category =  
        guild.channels.cache.find(  
          c =>  
            c.type ===  
              ChannelType.GuildCategory &&  
            c.name  
              .toLowerCase()  
              .includes("ticket")  
        );  

      if (!category) {  

        category =  
          await guild.channels.create({  
            name:  
              "🎫 TICKETS",  
            type:  
              ChannelType.GuildCategory  
          });  
      }  

      let logs =  
        guild.channels.cache.find(  
          c =>  
            c.type ===  
              ChannelType.GuildText &&  
            c.name ===  
              "zenith-logs"  
        );  

      if (!logs) {  

        logs =  
          await guild.channels.create({  
            name:  
              "zenith-logs",  
            type:  
              ChannelType.GuildText  
          });  
      }  

      cfg.ticketCategory =  
        category.id;  

      cfg.logs =  
        logs.id;  

      saveDB();  

      return interaction.reply({  
        content:  
          `✅ Zenith configurado automaticamente!\n\n` +  
          `🎫 Categoria: ${category}\n` +  
          `📋 Logs: ${logs}\n\n` +  
          `Agora use **/config** para personalizar tudo.`,  
        ephemeral: true  
      });  
    }  

    /* TICKET */  

    if (  
      interaction.commandName ===  
      "ticket"  
    ) {  

      const sub =  
        interaction.options  
          .getSubcommand();  

      if (  
        sub === "categoria"  
      ) {  

        cfg.ticketCategory =  
          interaction.options  
            .getChannel("canal")  
            .id;  

        saveDB();  

        return interaction.reply({  
          content:  
            "✅ Categoria dos tickets atualizada.",  
          ephemeral: true  
        });  
      }  

      if (  
        sub === "painel"  
      ) {  

        const result =  
          createTicketPanel(cfg);  

        const target =  
          cfg.ticketPanelChannel  
            ? guild.channels.cache.get(  
                cfg.ticketPanelChannel  
              )  
            : interaction.channel;  

        if (  
          !target ||  
          !target.isTextBased()  
        ) {  

          return interaction.reply({  
            content:  
              "❌ Configure primeiro o canal do painel em `/config`.",  
            ephemeral: true  
          });  
        }  

        await target.send(result);  

        return interaction.reply({  
          content:  
            `✅ Painel de tickets enviado em ${target}.`,  
          ephemeral: true  
        });  
      }  

      if (  
        sub === "editar"  
      ) {  

        const modal =  
          new ModalBuilder()  
            .setCustomId(  
              "ticket_edit_modal"  
            )  
            .setTitle(  
              "Editar painel Zenith"  
            );  

        const title =  
          new TextInputBuilder()  
            .setCustomId("title")  
            .setLabel("Título")  
            .setStyle(  
              TextInputStyle.Short  
            )  
            .setRequired(true)  
            .setValue(  
              cfg.ticketPanel.title  
            );  

        const description =  
          new TextInputBuilder()  
            .setCustomId(  
              "description"  
            )  
            .setLabel("Descrição")  
            .setStyle(  
              TextInputStyle.Paragraph  
            )  
            .setRequired(true)  
            .setValue(  
              cfg.ticketPanel.description  
            );  

        const color =  
          new TextInputBuilder()  
            .setCustomId("color")  
            .setLabel("Cor HEX")  
            .setStyle(  
              TextInputStyle.Short  
            )  
            .setRequired(true)  
            .setValue(  
              cfg.ticketPanel.color  
            );  

        const footer =  
          new TextInputBuilder()  
            .setCustomId("footer")  
            .setLabel("Footer")  
            .setStyle(  
              TextInputStyle.Short  
            )  
            .setRequired(true)  
            .setValue(  
              cfg.ticketPanel.footer  
            );  

        modal.addComponents(  
          new ActionRowBuilder()  
            .addComponents(title),  

          new ActionRowBuilder()  
            .addComponents(  
              description  
            ),  

          new ActionRowBuilder()  
            .addComponents(color),  

          new ActionRowBuilder()  
            .addComponents(footer)  
        );  

        return interaction.showModal(  
          modal  
        );  
      }  
    }  

    /* SECURITY */  

    if (  
      interaction.commandName ===  
      "security"  
    ) {  

      const sub =  
        interaction.options  
          .getSubcommand();  

      const value =  
        interaction.options  
          .getBoolean("ativar");  

      if (sub === "antiraid")  
        cfg.antiraid = value;  

      if (sub === "antispam")  
        cfg.antispam = value;  

      if (  
        sub ===  
        "botprotection"  
      )  
        cfg.botProtection = value;  

      saveDB();  

      return interaction.reply({  
        content:  
          `✅ Configuração atualizada: **${sub}** = ${  
            value  
              ? "ATIVADO"  
              : "DESATIVADO"  
          }`,  
        ephemeral: true  
      });  
    }  

    /* BLACKLIST */  

    if (  
      interaction.commandName ===  
      "blacklist"  
    ) {  

      const sub =  
        interaction.options  
          .getSubcommand();  

      if (sub === "list") {  

        const list =  
          cfg.blacklist.length  
            ? cfg.blacklist  
                .map(  
                  (id, i) =>  
                    `${i + 1}. <@${id}> — \`${id}\``  
                )  
                .join("\n")  
            : "A blacklist está vazia.";  

        return interaction.reply({  
          content:  
            `☠️ **Blacklist Permanente**\n\n${list}`,  
          ephemeral: true  
        });  
      }  

      const user =  
        interaction.options  
          .getUser("usuario");  

      if (sub === "add") {  

        if (  
          !cfg.blacklist.includes(  
            user.id  
          )  
        ) {  

          cfg.blacklist.push(  
            user.id  
          );  

          saveDB();  
        }  

        try {  
          await guild.members.ban(  
            user.id,  
            {  
              reason:  
                "Zenith: blacklist permanente"  
            }  
          );  
        } catch {}  

        return interaction.reply({  
          content:  
            `☠️ <@${user.id}> foi adicionado à blacklist permanente.`,  
          ephemeral: true  
        });  
      }  

      if (sub === "remove") {  

        cfg.blacklist =  
          cfg.blacklist.filter(  
            id =>  
              id !== user.id  
          );  

        saveDB();  

        return interaction.reply({  
          content:  
            `✅ <@${user.id}> removido da blacklist.`,  
          ephemeral: true  
        });  
      }  
    }  

    /* WHITELIST */  

    if (  
      interaction.commandName ===  
      "whitelist"  
    ) {  

      const sub =  
        interaction.options  
          .getSubcommand();  

      if (sub === "list") {  

        const list =  
          cfg.whitelist.length  
            ? cfg.whitelist  
                .map(  
                  id => `<@${id}>`  
                )  
                .join("\n")  
            : "Vazia";  

        return interaction.reply({  
          content:  
            `✅ **Whitelist**\n\n${list}`,  
          ephemeral: true  
        });  
      }  

      const user =  
        interaction.options  
          .getUser("usuario");  

      if (sub === "add") {  

        if (  
          !cfg.whitelist.includes(  
            user.id  
          )  
        ) {  

          cfg.whitelist.push(  
            user.id  
          );  

          saveDB();  
        }  

        return interaction.reply({  
          content:  
            `✅ <@${user.id}> adicionado à whitelist.`,  
          ephemeral: true  
        });  
      }  

      if (sub === "remove") {  

        cfg.whitelist =  
          cfg.whitelist.filter(  
            id =>  
              id !== user.id  
          );  

        saveDB();  

        return interaction.reply({  
          content:  
            `✅ <@${user.id}> removido da whitelist.`,  
          ephemeral: true  
        });  
      }  
    }  

    /* LOGS */  

    if (  
      interaction.commandName ===  
      "logs"  
    ) {  

      cfg.logs =  
        interaction.options  
          .getChannel("canal")  
          .id;  

      saveDB();  

      return interaction.reply({  
        content:  
          "✅ Canal de logs configurado.",  
        ephemeral: true  
      });  
    }  

    /* LOCKDOWN */  

    if (  
      interaction.commandName ===  
      "lockdown"  
    ) {  

      const enabled =  
        interaction.options  
          .getBoolean("ativar");  

      cfg.lockdown =  
        enabled;  

      saveDB();  

      for (  
        const channel  
        of guild.channels.cache.values()  
      ) {  

        if (  
          channel.type !==  
            ChannelType.GuildText &&  
          channel.type !==  
            ChannelType.GuildAnnouncement  
        )  
          continue;  

        try {  

          await channel.permissionOverwrites.edit(  
            guild.roles.everyone,  
            {  
              SendMessages:  
                enabled  
                  ? false  
                  : null  
            }  
          );  

        } catch {}  
      }  

      return interaction.reply({  
        content:  
          enabled  
            ? "🔒 Lockdown ativado."  
            : "🔓 Lockdown desativado.",  
        ephemeral: true  
      });  
    }  

    /* BAN */  

    if (  
      interaction.commandName ===  
      "ban"  
    ) {  

      const user =  
        interaction.options  
          .getUser("usuario");  

      const reason =  
        interaction.options  
          .getString("motivo") ||  
        "Sem motivo informado";  

      try {  

        await guild.members.ban(  
          user.id,  
          { reason }  
        );  

        await sendLog(  
          guild,  
          "🔨 BAN",  
          `**Usuário:** <@${user.id}>\n` +  
          `**Por:** <@${interaction.user.id}>\n` +  
          `**Motivo:** ${reason}`,  
          0xED4245  
        );  

        return interaction.reply({  
          content:  
            `🔨 <@${user.id}> foi banido.`,  
          ephemeral: true  
        });  

      } catch {  

        return interaction.reply({  
          content:  
            "❌ Não consegui banir esse usuário.",  
          ephemeral: true  
        });  
      }  
    }  

    /* KICK */  

    if (  
      interaction.commandName ===  
      "kick"  
    ) {  

      const user =  
        interaction.options  
          .getUser("usuario");  

      const reason =  
        interaction.options  
          .getString("motivo") ||  
        "Sem motivo informado";  

      const member =  
        await guild.members  
          .fetch(user.id)  
          .catch(() => null);  

      if (!member) {  

        return interaction.reply({  
          content:  
            "❌ Usuário não está no servidor.",  
          ephemeral: true  
        });  
      }  

      try {  

        await member.kick(  
          reason  
        );  

        return interaction.reply({  
          content:  
            `👢 <@${user.id}> foi expulso.`,  
          ephemeral: true  
        });  

      } catch {  

        return interaction.reply({  
          content:  
            "❌ Não consegui expulsar esse usuário.",  
          ephemeral: true  
        });  
      }  
    }  

    /* WARN */  

    if (  
      interaction.commandName ===  
      "warn"  
    ) {  

      const user =  
        interaction.options  
          .getUser("usuario");  

      const reason =  
        interaction.options  
          .getString("motivo") ||  
        "Sem motivo informado";  

      if (  
        !cfg.warns[user.id]  
      ) {  
        cfg.warns[user.id] = [];  
      }  

      cfg.warns[user.id].push({  
        reason,  
        moderator:  
          interaction.user.id,  
        date:  
          new Date().toISOString()  
      });  

      saveDB();  

      return interaction.reply({  
        content:  
          `⚠️ <@${user.id}> recebeu um warn.\n` +  
          `**Motivo:** ${reason}\n` +  
          `**Total:** ${cfg.warns[user.id].length}`,  
        ephemeral: true  
      });  
    }  
  }  

  /* =================================  
     CONFIGURAÇÃO DOS BOTÕES  
  ================================= */  

  if (  
    interaction.isButton() &&  
    interaction.customId ===  
      "config_first_owner"  
  ) {  

    const cfg =  
      guildConfig(  
        interaction.guild  
      );  

    if (  
      interaction.user.id !==  
      interaction.guild.ownerId  
    ) {  

      return interaction.reply({  
        content:  
          "❌ Apenas o dono atual do servidor pode fazer a primeira configuração.",  
        ephemeral: true  
      });  
    }  

    cfg.zenithOwner =  
      interaction.user.id;  

    if (  
      !cfg.whitelist.includes(  
        interaction.user.id  
      )  
    ) {  
      cfg.whitelist.push(  
        interaction.user.id  
      );  
    }  

    saveDB();  

    return interaction.update({  
      embeds: [  
        configEmbed(  
          interaction.guild  
        )  
      ],  
      components:  
        configButtons()  
    });  
  }  

  /* DONO */  

  if (  
    interaction.isButton() &&  
    interaction.customId ===  
      "config_owner"  
  ) {  

    const modal =  
      new ModalBuilder()  
        .setCustomId(  
          "config_owner_modal"  
        )  
        .setTitle(  
          "Definir dono do Zenith"  
        );  

    const input =  
      new TextInputBuilder()  
        .setCustomId("owner_id")  
        .setLabel(  
          "ID do usuário"  
        )  
        .setPlaceholder(  
          "Ex: 123456789012345678"  
        )  
        .setStyle(  
          TextInputStyle.Short  
        )  
        .setRequired(true);  

    modal.addComponents(  
      new ActionRowBuilder()  
        .addComponents(input)  
    );  

    return interaction.showModal(  
      modal  
    );  
  }  

  /* CATEGORIA */  

  if (  
    interaction.isButton() &&  
    interaction.customId ===  
      "config_category"  
  ) {  

    return interaction.reply({  
      content:  
        "🎫 **Selecione a categoria dos tickets:**",  
      components: [  

        new ActionRowBuilder()  
          .addComponents(  

            new ChannelSelectMenuBuilder()  
              .setCustomId(  
                "config_category_select"  
              )  
              .setPlaceholder(  
                "Escolher categoria"  
              )  
              .setChannelTypes(  
                ChannelType.GuildCategory  
              )  
              .setMinValues(1)  
              .setMaxValues(1)  

          )  

      ],  
      ephemeral: true  
    });  
  }  

  /* LOGS */  

  if (  
    interaction.isButton() &&  
    interaction.customId ===  
      "config_logs"  
  ) {  

    return interaction.reply({  
      content:  
        "📋 **Selecione o canal de logs:**",  
      components: [  

        new ActionRowBuilder()  
          .addComponents(  

            new ChannelSelectMenuBuilder()  
              .setCustomId(  
                "config_logs_select"  
              )  
              .setPlaceholder(  
                "Escolher canal de logs"  
              )  
              .setChannelTypes(  
                ChannelType.GuildText  
              )  
              .setMinValues(1)  
              .setMaxValues(1)  

          )  

      ],  
      ephemeral: true  
    });  
  }  

  /* CANAL DO PAINEL */  

  if (  
    interaction.isButton() &&  
    interaction.customId ===  
      "config_panel"  
  ) {  

    return interaction.reply({  
      content:  
        "🎟️ **Selecione o canal onde o painel de tickets será enviado:**",  
      components: [  

        new ActionRowBuilder()  
          .addComponents(  

            new ChannelSelectMenuBuilder()  
              .setCustomId(  
                "config_panel_select"  
              )  
              .setPlaceholder(  
                "Escolher canal do painel"  
              )  
              .setChannelTypes(  
                ChannelType.GuildText  
              )  
              .setMinValues(1)  
              .setMaxValues(1)  

          )  

      ],  
      ephemeral: true  
    });  
  }  

  /* =================================

CANAL DE AVALIAÇÕES
================================= */

if (  
    interaction.isButton() &&  
    interaction.customId ===  
      "config_feedback"  
  ) {  

    return interaction.reply({  
      content:  
        "⭐ **Selecione o canal onde as avaliações serão enviadas:**",  

      components: [  

        new ActionRowBuilder()  
          .addComponents(  

            new ChannelSelectMenuBuilder()  
              .setCustomId(  
                "config_feedback_select"  
              )  
              .setPlaceholder(  
                "Escolher canal de avaliações"  
              )  
              .setChannelTypes(  
                ChannelType.GuildText  
              )  
              .setMinValues(1)  
              .setMaxValues(1)  

          )  

      ],  

      ephemeral: true  
    });  
  }  

  /* SEGURANÇA */  

  if (  
    interaction.isButton() &&  
    interaction.customId ===  
      "config_security"  
  ) {  

    const cfg =  
      guildConfig(  
        interaction.guild  
      );  

    const row1 =  
      new ActionRowBuilder()  
        .addComponents(  

          new ButtonBuilder()  
            .setCustomId(  
              "toggle_antiraid"  
            )  
            .setLabel(  
              `Anti-Raid: ${  
                cfg.antiraid  
                  ? "ON"  
                  : "OFF"  
              }`  
            )  
            .setStyle(  
              cfg.antiraid  
                ? ButtonStyle.Success  
                : ButtonStyle.Danger  
            ),  

          new ButtonBuilder()  
            .setCustomId(  
              "toggle_antispam"  
            )  
            .setLabel(  
              `Anti-Spam: ${  
                cfg.antispam  
                  ? "ON"  
                  : "OFF"  
              }`  
            )  
            .setStyle(  
              cfg.antispam  
                ? ButtonStyle.Success  
                : ButtonStyle.Danger  
            ),  

          new ButtonBuilder()  
            .setCustomId(  
              "toggle_antibot"  
            )  
            .setLabel(  
              `Anti-Bot: ${  
                cfg.botProtection  
                  ? "ON"  
                  : "OFF"  
              }`  
            )  
            .setStyle(  
              cfg.botProtection  
                ? ButtonStyle.Success  
                : ButtonStyle.Danger  
            )  

        );  

    return interaction.reply({  
      content:  
        "🛡️ **Configuração de segurança**",  
      components: [row1],  
      ephemeral: true  
    });  
  }  

  /* ATUALIZAR */  

  if (  
    interaction.isButton() &&  
    interaction.customId ===  
      "config_refresh"  
  ) {  

    return interaction.update({  
      embeds: [  
        configEmbed(  
          interaction.guild  
        )  
      ],  
      components:  
        configButtons()  
    });  
  }  

  /* TOGGLES */  

  if (  
    interaction.isButton() &&  
    interaction.customId ===  
      "toggle_antiraid"  
  ) {  

    const cfg =  
      guildConfig(  
        interaction.guild  
      );  

    cfg.antiraid =  
      !cfg.antiraid;  

    saveDB();  

    return interaction.update({  
      content:  
        `🛡️ Anti-Raid agora está **${  
          cfg.antiraid  
            ? "ATIVADO"  
            : "DESATIVADO"  
        }**.`,  
      components: []  
    });  
  }  

  if (  
    interaction.isButton() &&  
    interaction.customId ===  
      "toggle_antispam"  
  ) {  

    const cfg =  
      guildConfig(  
        interaction.guild  
      );  

    cfg.antispam =  
      !cfg.antispam;  

    saveDB();  

    return interaction.update({  
      content:  
        `💬 Anti-Spam agora está **${  
          cfg.antispam  
            ? "ATIVADO"  
            : "DESATIVADO"  
        }**.`,  
      components: []  
    });  
  }  

  if (  
    interaction.isButton() &&  
    interaction.customId ===  
      "toggle_antibot"  
  ) {  

    const cfg =  
      guildConfig(  
        interaction.guild  
      );  

    cfg.botProtection =  
      !cfg.botProtection;  

    saveDB();  

    return interaction.update({  
      content:  
        `🤖 Anti-Bot agora está **${  
          cfg.botProtection  
            ? "ATIVADO"  
            : "DESATIVADO"  
        }**.`,  
      components: []  
    });  
  }  

  /* =================================  
     SELECT CATEGORIA  
  ================================= */  

  if (  
    interaction.isChannelSelectMenu()  
  ) {  

    const cfg =  
      guildConfig(  
        interaction.guild  
      );  

    const channel =  
      interaction.channels.first();  

    if (  
      interaction.customId ===  
      "config_category_select"  
    ) {  

      cfg.ticketCategory =  
        channel.id;  

      saveDB();  

      return interaction.update({  
        content:  
          `✅ Categoria dos tickets definida: ${channel}`,  
        components: []  
      });  
    }  

    if (  
      interaction.customId ===  
      "config_logs_select"  
    ) {  

      cfg.logs =  
        channel.id;  

      saveDB();  

      return interaction.update({  
        content:  
          `✅ Canal de logs definido: ${channel}`,  
        components: []  
      });  
    }  

    if (  
      interaction.customId ===  
      "config_panel_select"  
    ) {  

      cfg.ticketPanelChannel =  
        channel.id;  

      saveDB();  

      return interaction.update({  
        content:  
          `✅ Canal do painel definido: ${channel}`,  
        components: []  
      });  
    }  
  }  

} catch (error) {  

  console.error(  
    "[INTERACTION ERROR]",  
    error  
  );  

  if (  
    !interaction.replied &&  
    !interaction.deferred  
  ) {  

    try {  

      await interaction.reply({  
        content:  
          "❌ Ocorreu um erro ao executar esta ação.",  
        ephemeral: true  
      });  

    } catch {}  
  }  
}

}
);

/* =========================================
MODAIS
========================================= */

client.on(
"interactionCreate",
async interaction => {

if (  
  !interaction.isModalSubmit()  
)  
  return;  

try {  

  if (  
    interaction.customId ===  
    "config_owner_modal"  
  ) {  

    if (  
      interaction.user.id !==  
      interaction.guild.ownerId  
    ) {  

      return interaction.reply({  
        content:  
          "❌ Apenas o dono atual do servidor pode alterar o proprietário do Zenith.",  
        ephemeral: true  
      });  
    }  

    const cfg =  
      guildConfig(  
        interaction.guild  
      );  

    const id =  
      interaction.fields  
        .getTextInputValue(  
          "owner_id"  
        )  
        .trim();  

    if (!/^\d{17,20}$/.test(id)) {  

      return interaction.reply({  
        content:  
          "❌ ID de usuário inválido.",  
        ephemeral: true  
      });  
    }  

    cfg.zenithOwner =  
      id;  

    if (  
      !cfg.whitelist.includes(id)  
    ) {  
      cfg.whitelist.push(id);  
    }  

    saveDB();  

    return interaction.reply({  
      content:  
        `👑 O novo proprietário do Zenith é <@${id}>.`,  
      ephemeral: true  
    });  
  }  

  if (  
    interaction.customId ===  
    "ticket_edit_modal"  
  ) {  

    if (  
      !isZenithOwner(  
        interaction  
      )  
    ) {  

      return interaction.reply({  
        content:  
          "❌ Você não é o dono do Zenith.",  
        ephemeral: true  
      });  
    }  

    const cfg =  
      guildConfig(  
        interaction.guild  
      );  

    cfg.ticketPanel.title =  
      interaction.fields  
        .getTextInputValue(  
          "title"  
        );  

    cfg.ticketPanel.description =  
      interaction.fields  
        .getTextInputValue(  
          "description"  
        );  

    cfg.ticketPanel.color =  
      interaction.fields  
        .getTextInputValue(  
          "color"  
        );  

    cfg.ticketPanel.footer =  
      interaction.fields  
        .getTextInputValue(  
          "footer"  
        );  

    saveDB();  

    return interaction.reply({  
      content:  
        "✅ Painel de tickets atualizado.",  
      ephemeral: true  
    });  
  }  

} catch (error) {  

  console.error(  
    "[MODAL ERROR]",  
    error  
  );  
}

}
);
/* =========================================
ATUALIZAÇÃO AUTOMÁTICA DO /INFO
========================================= */

client.on(
"guildMemberAdd",
async member => {
await updateServerInfo(member.guild);
}
);

client.on(
"guildMemberRemove",
async member => {
await updateServerInfo(member.guild);
}
);

client.on(
"channelCreate",
async channel => {

if (!channel.guild)  
  return;  

await updateServerInfo(  
  channel.guild  
);

}
);

client.on(
"channelDelete",
async channel => {

if (!channel.guild)  
  return;  

await updateServerInfo(  
  channel.guild  
);

}
);

client.on(
"roleCreate",
async role => {
await updateServerInfo(
role.guild
);
}
);

client.on(
"roleDelete",
async role => {
await updateServerInfo(
role.guild
);
}
);

client.on(
"guildMemberUpdate",
async (oldMember, newMember) => {

if (  
  oldMember.premiumSinceTimestamp !==  
  newMember.premiumSinceTimestamp  
) {  

  await updateServerInfo(  
    newMember.guild  
  );  
}

}
);

/* =========================================
READY
========================================= */

client.once(
"ready",
async () => {

console.log(  
  "======================================"  
);  

console.log(  
  `ZENITH ONLINE: ${client.user.tag}`  
);  

console.log(  
  `SERVIDORES: ${client.guilds.cache.size}`  
);  

console.log(  
  "======================================"  
);  

for (  
  const guild  
  of client.guilds.cache.values()  
) {  

  try {  

    guildConfig(guild);  

    await guild.commands.set(  
      commands  
    );  

    console.log(  
      `[COMMANDS] ${commands.length} registrados em ${guild.name}`  
    );  

  } catch (error) {  

    console.error(  
      `[COMMANDS ERROR] ${guild.name}`,  
      error.message  
    );  
  }  
}  

console.log(  
  "======================================"  
);  

console.log(  
  "ZENITH TOTALMENTE INICIADO"  
);  

console.log(  
  "======================================"  
);

}
);

/* =========================================
NOVO SERVIDOR
========================================= */

client.on(
"guildCreate",
async guild => {

try {  

  guildConfig(guild);  

  await guild.commands.set(  
    commands  
  );  

} catch (error) {  

  console.error(  
    "[GUILD ERROR]",  
    error  
  );  
}

}
);

/* =========================================
SERVIDOR WEB PARA RENDER
========================================= */

const PORT =
process.env.PORT || 3000;

http.createServer(
(req, res) => {

res.writeHead(  
  200,  
  {  
    "Content-Type":  
      "text/plain; charset=utf-8"  
  }  
);  

res.end(  
  "Zenith Online"  
);

}
).listen(
PORT,
"0.0.0.0",
() => {

console.log(  
  `[WEB] Porta ${PORT} ativa`  
);

}
);

/* =========================================
ERROS
========================================= */

client.on(
"error",
error => {
console.error(
"[DISCORD ERROR]",
error
);
}
);

process.on(
"unhandledRejection",
error => {
console.error(
"[UNHANDLED]",
error
);
}
);

process.on(
"uncaughtException",
error => {
console.error(
"[UNCAUGHT]",
error
);
}
);

/* =========================================
LOGIN
========================================= */

if (!process.env.DISCORD_TOKEN) {

console.error(
"❌ DISCORD_TOKEN não encontrado."
);

process.exit(1);
}

client.login(
process.env.DISCORD_TOKEN
)
.then(() => {

console.log(
"🔑 Login enviado ao Discord."
);

})
.catch(error => {

console.error(
"❌ ERRO AO CONECTAR:",
error
);

});