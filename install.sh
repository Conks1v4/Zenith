#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "======================================"
echo "        ZENITH DISCORD BOT"
echo "======================================"

cd "$(dirname "$0")"

echo "[1/5] Criando package.json..."

cat > package.json <<'EOF'
{
  "name": "zenith",
  "version": "1.0.0",
  "description": "Zenith Security, Tickets and Moderation Bot",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js"
  },
  "dependencies": {
    "discord.js": "^14.27.0",
    "dotenv": "^17.4.2",
    "lowdb": "^7.0.1"
  }
}
EOF

echo "[2/5] Criando .env.example..."

cat > .env.example <<'EOF'
DISCORD_TOKEN=COLOQUE_SEU_TOKEN_AQUI
CLIENT_ID=COLOQUE_SEU_CLIENT_ID_AQUI
EOF

[ -f .env ] || cp .env.example .env

echo "[3/5] Criando estrutura..."

mkdir -p src/{commands,events,security,tickets,moderation,database}
mkdir -p data

cat > data/database.json <<'EOF'
{
  "servers": {}
}
EOF

echo "[4/5] Criando código..."

cat > src/database/database.js <<'EOF'
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "../../data/database.json");

function ensureDatabase() {
    if (!fs.existsSync(file)) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ servers: {} }, null, 2));
    }
}

function load() {
    ensureDatabase();

    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return { servers: {} };
    }
}

function save(data) {
    ensureDatabase();
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getGuild(guildId) {
    const db = load();

    if (!db.servers[guildId]) {
        db.servers[guildId] = {
            logs: null,
            ticket: {
                category: null,
                channel: null,
                embed: {
                    title: "🎫 Suporte",
                    description: "Clique em um botão abaixo para abrir um ticket.",
                    color: 0x5865F2,
                    footer: "Zenith Tickets",
                    image: null,
                    thumbnail: null
                },
                buttons: [
                    {
                        id: "support",
                        label: "Suporte",
                        emoji: "🎫"
                    },
                    {
                        id: "denuncia",
                        label: "Denúncia",
                        emoji: "🚨"
                    },
                    {
                        id: "duvida",
                        label: "Dúvida",
                        emoji: "❓"
                    },
                    {
                        id: "compras",
                        label: "Compras",
                        emoji: "💰"
                    }
                ]
            },
            security: {
                antiraid: true,
                antispam: true,
                botProtection: true,
                lockdown: false
            },
            whitelist: [],
            blacklist: [],
            warns: {},
            feedbacks: []
        };

        save(db);
    }

    return db.servers[guildId];
}

function updateGuild(guildId, callback) {
    const db = load();
    const guild = getGuild(guildId);

    callback(guild);

    db.servers[guildId] = guild;
    save(db);

    return guild;
}

module.exports = {
    load,
    save,
    getGuild,
    updateGuild
};
EOF

cat > src/security/permissions.js <<'EOF'
function isOwner(interaction) {
    if (!interaction.guild) return false;
    return interaction.user.id === interaction.guild.ownerId;
}

async function requireOwner(interaction) {
    if (!isOwner(interaction)) {
        await interaction.reply({
            content: "❌ Apenas o dono deste servidor pode utilizar os comandos do Zenith.",
            ephemeral: true
        });

        return false;
    }

    return true;
}

module.exports = {
    isOwner,
    requireOwner
};
EOF

cat > src/security/blacklist.js <<'EOF'
const { getGuild, updateGuild } = require("../database/database");

function isBlacklisted(guildId, userId) {
    const guild = getGuild(guildId);
    return guild.blacklist.some(x => x.id === userId);
}

function addBlacklist(guildId, userId, reason = "Ação de segurança") {
    updateGuild(guildId, guild => {
        if (!guild.blacklist.some(x => x.id === userId)) {
            guild.blacklist.push({
                id: userId,
                reason,
                date: new Date().toISOString()
            });
        }
    });
}

function removeBlacklist(guildId, userId) {
    updateGuild(guildId, guild => {
        guild.blacklist = guild.blacklist.filter(x => x.id !== userId);
    });
}

module.exports = {
    isBlacklisted,
    addBlacklist,
    removeBlacklist
};
EOF

cat > src/security/whitelist.js <<'EOF'
const { getGuild, updateGuild } = require("../database/database");

function isWhitelisted(guildId, id) {
    const guild = getGuild(guildId);
    return guild.whitelist.includes(id);
}

function addWhitelist(guildId, id) {
    updateGuild(guildId, guild => {
        if (!guild.whitelist.includes(id)) {
            guild.whitelist.push(id);
        }
    });
}

function removeWhitelist(guildId, id) {
    updateGuild(guildId, guild => {
        guild.whitelist = guild.whitelist.filter(x => x !== id);
    });
}

module.exports = {
    isWhitelisted,
    addWhitelist,
    removeWhitelist
};
EOF

cat > src/security/antiSpam.js <<'EOF'
const { isWhitelisted } = require("./whitelist");

const messages = new Map();

async function checkSpam(message) {
    if (!message.guild || message.author.bot) return;

    if (isWhitelisted(message.guild.id, message.author.id)) return;

    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();

    let data = messages.get(key);

    if (!data || now - data.start > 5000) {
        data = {
            start: now,
            count: 1
        };
    } else {
        data.count++;
    }

    messages.set(key, data);

    if (data.count >= 10) {
        try {
            await message.member.timeout(
                60 * 1000,
                "Zenith Anti-Spam"
            );

            await message.channel.send({
                content: `⚠️ ${message.author} foi temporariamente silenciado por spam.`
            });
        } catch {}

        messages.delete(key);
    }
}

module.exports = {
    checkSpam
};
EOF

cat > src/security/antiRaid.js <<'EOF'
const { isWhitelisted } = require("./whitelist");
const { addBlacklist } = require("./blacklist");

const actions = new Map();

function registerAction(guildId, userId, type) {
    const key = `${guildId}:${userId}:${type}`;
    const now = Date.now();

    let data = actions.get(key);

    if (!data || now - data.start > 10000) {
        data = {
            start: now,
            count: 1
        };
    } else {
        data.count++;
    }

    actions.set(key, data);

    return data.count;
}

async function punish(guild, userId, reason) {
    if (userId === guild.ownerId) return;

    if (isWhitelisted(guild.id, userId)) return;

    const member = await guild.members.fetch(userId).catch(() => null);

    if (!member) return;

    addBlacklist(guild.id, userId, reason);

    await member.ban({
        reason: `Zenith Anti-Raid: ${reason}`
    }).catch(() => {});
}

async function checkAction(guild, userId, type) {
    if (!guild || !userId) return;

    if (userId === guild.ownerId) return;

    if (isWhitelisted(guild.id, userId)) return;

    const count = registerAction(guild.id, userId, type);

    if (count >= 4) {
        await punish(
            guild,
            userId,
            `Ações suspeitas detectadas: ${type}`
        );
    }
}

module.exports = {
    checkAction
};
EOF

cat > src/security/botProtection.js <<'EOF'
const { isWhitelisted } = require("./whitelist");
const { addBlacklist } = require("./blacklist");

async function checkBot(member) {
    if (!member.guild) return;

    if (!member.user.bot) return;

    const audit = await member.guild.fetchAuditLogs({
        type: 28,
        limit: 5
    }).catch(() => null);

    if (!audit) return;

    const entry = audit.entries.find(
        x =>
            x.target &&
            x.target.id === member.id &&
            Date.now() - x.createdTimestamp < 10000
    );

    if (!entry) return;

    const executor = entry.executor;

    if (!executor) return;

    if (executor.id === member.guild.ownerId) return;

    if (isWhitelisted(member.guild.id, executor.id)) return;

    addBlacklist(
        member.guild.id,
        executor.id,
        "Adição de bot não autorizado"
    );

    const executorMember = await member.guild.members
        .fetch(executor.id)
        .catch(() => null);

    if (executorMember) {
        await executorMember.ban({
            reason: "Zenith: bot não autorizado"
        }).catch(() => {});
    }

    await member.kick("Zenith: bot não autorizado").catch(() => {});
}

module.exports = {
    checkBot
};
EOF

cat > src/tickets/ticketEmbed.js <<'EOF'
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

function createTicketEmbed(config) {
    const embed = new EmbedBuilder()
        .setTitle(config.embed.title)
        .setDescription(config.embed.description)
        .setColor(config.embed.color || 0x5865F2)
        .setFooter({
            text: config.embed.footer || "Zenith Tickets"
        });

    if (config.embed.image) {
        embed.setImage(config.embed.image);
    }

    if (config.embed.thumbnail) {
        embed.setThumbnail(config.embed.thumbnail);
    }

    const buttons = config.buttons.map(button =>
        new ButtonBuilder()
            .setCustomId(`zenith_ticket_${button.id}`)
            .setLabel(button.label)
            .setEmoji(button.emoji)
            .setStyle(ButtonStyle.Primary)
    );

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(buttons)
        ]
    };
}

module.exports = {
    createTicketEmbed
};
EOF

cat > src/tickets/ticketCreate.js <<'EOF'
const {
    ChannelType,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

const { getGuild } = require("../database/database");

async function createTicket(interaction, type) {
    const config = getGuild(interaction.guild.id);

    const existing = interaction.guild.channels.cache.find(
        channel =>
            channel.topic === `Zenith Ticket | ${interaction.user.id}`
    );

    if (existing) {
        return interaction.reply({
            content: `❌ Você já possui um ticket aberto: ${existing}`,
            ephemeral: true
        });
    }

    const channel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`.toLowerCase().slice(0, 90),
        type: ChannelType.GuildText,
        parent: config.ticket.category || null,
        topic: `Zenith Ticket | ${interaction.user.id}`,
        permissionOverwrites: [
            {
                id: interaction.guild.id,
                deny: [PermissionFlagsBits.ViewChannel]
            },
            {
                id: interaction.user.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory
                ]
            }
        ]
    });

    const embed = new EmbedBuilder()
        .setTitle(`🎫 Ticket de ${type}`)
        .setDescription(
            `Olá ${interaction.user}!\n\n` +
            `Explique seu problema e aguarde o atendimento.`
        )
        .setColor(0x5865F2);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("zenith_ticket_close")
            .setLabel("Fechar Ticket")
            .setEmoji("🔒")
            .setStyle(ButtonStyle.Danger)
    );

    await channel.send({
        content: `${interaction.user}`,
        embeds: [embed],
        components: [row]
    });

    await interaction.reply({
        content: `✅ Ticket criado: ${channel}`,
        ephemeral: true
    });
}

module.exports = {
    createTicket
};
EOF

cat > src/tickets/feedback.js <<'EOF'
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} = require("discord.js");

const { updateGuild } = require("../database/database");

async function requestFeedback(user, guild, ticketName) {
    const row = new ActionRowBuilder();

    for (let i = 1; i <= 5; i++) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`zenith_feedback_${i}`)
                .setLabel(`${i}`)
                .setEmoji("⭐")
                .setStyle(ButtonStyle.Secondary)
        );
    }

    const embed = new EmbedBuilder()
        .setTitle("⭐ Avalie seu atendimento")
        .setDescription(
            `Seu ticket **${ticketName}** foi fechado.\n\n` +
            `Como foi seu atendimento?\n` +
            `Escolha uma nota de 1 a 5 estrelas.`
        )
        .setColor(0xFEE75C);

    await user.send({
        embeds: [embed],
        components: [row]
    }).catch(() => {});
}

function saveFeedback(guildId, userId, rating) {
    updateGuild(guildId, guild => {
        guild.feedbacks.push({
            userId,
            rating,
            date: new Date().toISOString()
        });
    });
}

module.exports = {
    requestFeedback,
    saveFeedback
};
EOF

cat > src/tickets/ticketClose.js <<'EOF'
const {
    AttachmentBuilder,
    EmbedBuilder
} = require("discord.js");

const { requestFeedback } = require("./feedback");

async function closeTicket(interaction) {
    const channel = interaction.channel;

    const ownerId = channel.topic?.split("|")[1]?.trim();

    if (!ownerId) {
        return interaction.reply({
            content: "❌ Este canal não parece ser um ticket do Zenith.",
            ephemeral: true
        });
    }

    await interaction.reply({
        content: "🔒 Fechando ticket...",
        ephemeral: true
    });

    const messages = await channel.messages.fetch({
        limit: 100
    });

    const transcript = messages
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map(m =>
            `[${new Date(m.createdTimestamp).toLocaleString()}] ` +
            `${m.author.tag}: ${m.content}`
        )
        .join("\n");

    const file = new AttachmentBuilder(
        Buffer.from(transcript || "Sem mensagens."),
        {
            name: `${channel.name}-transcript.txt`
        }
    );

    const member = await interaction.guild.members
        .fetch(ownerId)
        .catch(() => null);

    if (member) {
        const embed = new EmbedBuilder()
            .setTitle("🎫 Ticket encerrado")
            .setDescription(
                `Seu ticket **${channel.name}** foi encerrado.\n\n` +
                `Obrigado por utilizar nosso suporte!`
            )
            .setColor(0x5865F2);

        await member.send({
            embeds: [embed],
            files: [file]
        }).catch(() => {});

        await requestFeedback(
            member.user,
            interaction.guild,
            channel.name
        );
    }

    setTimeout(() => {
        channel.delete("Zenith: ticket fechado").catch(() => {});
    }, 3000);
}

module.exports = {
    closeTicket
};
EOF

cat > src/commands/index.js <<'EOF'
const {
    SlashCommandBuilder,
    PermissionFlagsBits
} = require("discord.js");

module.exports = [
    new SlashCommandBuilder()
        .setName("setup")
        .setDescription("Configura o Zenith"),

    new SlashCommandBuilder()
        .setName("ticket")
        .setDescription("Gerencia o sistema de tickets")
        .addSubcommand(sub =>
            sub
                .setName("painel")
                .setDescription("Envia o painel de tickets")
        )
        .addSubcommand(sub =>
            sub
                .setName("categoria")
                .setDescription("Define a categoria dos tickets")
                .addChannelOption(opt =>
                    opt
                        .setName("categoria")
                        .setDescription("Categoria")
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName("embed")
                .setDescription("Edita o embed do painel")
                .addStringOption(opt =>
                    opt
                        .setName("titulo")
                        .setDescription("Título")
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName("descricao")
                        .setDescription("Descrição")
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName("cor")
                        .setDescription("Cor HEX, exemplo: #5865F2")
                )
        ),

    new SlashCommandBuilder()
        .setName("blacklist")
        .setDescription("Gerencia a blacklist")
        .addSubcommand(sub =>
            sub
                .setName("add")
                .setDescription("Adiciona alguém à blacklist")
                .addUserOption(opt =>
                    opt
                        .setName("usuario")
                        .setDescription("Usuário")
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName("motivo")
                        .setDescription("Motivo")
                )
        )
        .addSubcommand(sub =>
            sub
                .setName("remove")
                .setDescription("Remove alguém da blacklist")
                .addUserOption(opt =>
                    opt
                        .setName("usuario")
                        .setDescription("Usuário")
                        .setRequired(true)
                )
        ),

    new SlashCommandBuilder()
        .setName("whitelist")
        .setDescription("Gerencia a whitelist")
        .addSubcommand(sub =>
            sub
                .setName("add")
                .setDescription("Adiciona à whitelist")
                .addUserOption(opt =>
                    opt
                        .setName("usuario")
                        .setDescription("Usuário")
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName("remove")
                .setDescription("Remove da whitelist")
                .addUserOption(opt =>
                    opt
                        .setName("usuario")
                        .setDescription("Usuário")
                        .setRequired(true)
                )
        ),

    new SlashCommandBuilder()
        .setName("lockdown")
        .setDescription("Ativa ou desativa o lockdown")
        .addBooleanOption(opt =>
            opt
                .setName("ativar")
                .setDescription("Ativar lockdown")
                .setRequired(true)
        )
].map(command => command.toJSON());
EOF

cat > src/index.js <<'EOF'
require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    Partials,
    REST,
    Routes,
    EmbedBuilder
} = require("discord.js");

const commands = require("./commands");
const { requireOwner } = require("./security/permissions");
const { checkSpam } = require("./security/antiSpam");
const { checkAction } = require("./security/antiRaid");
const { checkBot } = require("./security/botProtection");
const { addBlacklist, removeBlacklist } = require("./security/blacklist");
const { addWhitelist, removeWhitelist } = require("./security/whitelist");
const { getGuild, updateGuild } = require("./database/database");
const { createTicket } = require("./tickets/ticketCreate");
const { closeTicket } = require("./tickets/ticketClose");
const { saveFeedback } = require("./tickets/feedback");
const { createTicketEmbed } = require("./tickets/ticketEmbed");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ],
    partials: [
        Partials.Channel,
        Partials.Message,
        Partials.GuildMember
    ]
});

client.once("ready", async () => {
    console.log("=================================");
    console.log(`Zenith online como ${client.user.tag}`);
    console.log(`Servidores: ${client.guilds.cache.size}`);
    console.log("=================================");

    const rest = new REST({ version: "10" })
        .setToken(process.env.DISCORD_TOKEN);

    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );

        console.log("Comandos registrados.");
    } catch (error) {
        console.error("Erro ao registrar comandos:", error);
    }
});

client.on("messageCreate", async message => {
    if (!message.guild || message.author.bot) return;

    await checkSpam(message);

    if (message.mentions.everyone) {
        await checkAction(
            message.guild,
            message.author.id,
            "mention spam"
        );
    }
});

client.on("channelCreate", async channel => {
    if (!channel.guild) return;

    const logs = await channel.guild.fetchAuditLogs({
        type: 10,
        limit: 5
    }).catch(() => null);

    if (!logs) return;

    const entry = logs.entries.find(
        x =>
            x.target &&
            x.target.id === channel.id &&
            Date.now() - x.createdTimestamp < 10000
    );

    if (entry) {
        await checkAction(
            channel.guild,
            entry.executor?.id,
            "criação de canais"
        );
    }
});

client.on("channelDelete", async channel => {
    if (!channel.guild) return;

    const logs = await channel.guild.fetchAuditLogs({
        type: 12,
        limit: 5
    }).catch(() => null);

    if (!logs) return;

    const entry = logs.entries.find(
        x =>
            x.target &&
            x.target.id === channel.id &&
            Date.now() - x.createdTimestamp < 10000
    );

    if (entry) {
        await checkAction(
            channel.guild,
            entry.executor?.id,
            "exclusão de canais"
        );
    }
});

client.on("channelUpdate", async (oldChannel, newChannel) => {
    if (!newChannel.guild) return;

    if (oldChannel.name === newChannel.name) return;

    const logs = await newChannel.guild.fetchAuditLogs({
        type: 11,
        limit: 5
    }).catch(() => null);

    if (!logs) return;

    const entry = logs.entries.find(
        x =>
            x.target &&
            x.target.id === newChannel.id &&
            Date.now() - x.createdTimestamp < 10000
    );

    if (entry) {
        await checkAction(
            newChannel.guild,
            entry.executor?.id,
            "renomeação de canais"
        );
    }
});

client.on("guildMemberAdd", async member => {
    await checkBot(member);
});

client.on("interactionCreate", async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            if (!(await requireOwner(interaction))) return;

            const guild = getGuild(interaction.guild.id);

            if (interaction.commandName === "setup") {
                return interaction.reply({
                    content:
                        "✅ Zenith configurado!\n\n" +
                        "🛡️ Anti-Raid: ATIVO\n" +
                        "🚫 Anti-Spam: ATIVO\n" +
                        "🤖 Proteção contra bots: ATIVA\n" +
                        "🎫 Tickets: disponíveis",
                    ephemeral: true
                });
            }

            if (interaction.commandName === "ticket") {
                const sub = interaction.options.getSubcommand();

                if (sub === "categoria") {
                    const category =
                        interaction.options.getChannel("categoria");

                    if (category.type !== 4) {
                        return interaction.reply({
                            content: "❌ Selecione uma categoria.",
                            ephemeral: true
                        });
                    }

                    updateGuild(
                        interaction.guild.id,
                        g => {
                            g.ticket.category = category.id;
                        }
                    );

                    return interaction.reply({
                        content: `✅ Categoria definida para ${category}.`,
                        ephemeral: true
                    });
                }

                if (sub === "embed") {
                    const title =
                        interaction.options.getString("titulo");

                    const description =
                        interaction.options.getString("descricao");

                    const color =
                        interaction.options.getString("cor");

                    let parsedColor = 0x5865F2;

                    if (color) {
                        parsedColor = parseInt(
                            color.replace("#", ""),
                            16
                        );

                        if (Number.isNaN(parsedColor)) {
                            parsedColor = 0x5865F2;
                        }
                    }

                    updateGuild(
                        interaction.guild.id,
                        g => {
                            g.ticket.embed.title = title;
                            g.ticket.embed.description = description;
                            g.ticket.embed.color = parsedColor;
                        }
                    );

                    return interaction.reply({
                        content:
                            "✅ Embed do ticket atualizado!\n\n" +
                            `**Título:** ${title}\n` +
                            `**Descrição:** ${description}\n` +
                            `**Cor:** ${color || "#5865F2"}`,
                        ephemeral: true
                    });
                }

                if (sub === "painel") {
                    const config = getGuild(
                        interaction.guild.id
                    );

                    return interaction.channel.send(
                        createTicketEmbed(config)
                    ).then(() =>
                        interaction.reply({
                            content:
                                "✅ Painel de tickets enviado.",
                            ephemeral: true
                        })
                    );
                }
            }

            if (interaction.commandName === "blacklist") {
                const sub =
                    interaction.options.getSubcommand();

                const user =
                    interaction.options.getUser("usuario");

                if (sub === "add") {
                    const reason =
                        interaction.options.getString("motivo") ||
                        "Blacklist manual";

                    addBlacklist(
                        interaction.guild.id,
                        user.id,
                        reason
                    );

                    return interaction.reply({
                        content:
                            `⚫ ${user} foi adicionado à blacklist.`,
                        ephemeral: true
                    });
                }

                if (sub === "remove") {
                    removeBlacklist(
                        interaction.guild.id,
                        user.id
                    );

                    return interaction.reply({
                        content:
                            `🟢 ${user} foi removido da blacklist.`,
                        ephemeral: true
                    });
                }
            }

            if (interaction.commandName === "whitelist") {
                const sub =
                    interaction.options.getSubcommand();

                const user =
                    interaction.options.getUser("usuario");

                if (sub === "add") {
                    addWhitelist(
                        interaction.guild.id,
                        user.id
                    );

                    return interaction.reply({
                        content:
                            `🟢 ${user} foi adicionado à whitelist.`,
                        ephemeral: true
                    });
                }

                if (sub === "remove") {
                    removeWhitelist(
                        interaction.guild.id,
                        user.id
                    );

                    return interaction.reply({
                        content:
                            `🗑️ ${user} foi removido da whitelist.`,
                        ephemeral: true
                    });
                }
            }

            if (interaction.commandName === "lockdown") {
                const ativar =
                    interaction.options.getBoolean("ativar");

                updateGuild(
                    interaction.guild.id,
                    g => {
                        g.security.lockdown = ativar;
                    }
                );

                return interaction.reply({
                    content:
                        ativar
                            ? "🔒 Lockdown ativado."
                            : "🔓 Lockdown desativado.",
                    ephemeral: true
                });
            }
        }

        if (interaction.isButton()) {
            if (
                interaction.customId.startsWith(
                    "zenith_ticket_"
                )
            ) {
                const action =
                    interaction.customId.replace(
                        "zenith_ticket_",
                        ""
                    );

                if (action === "close") {
                    return closeTicket(interaction);
                }

                return createTicket(
                    interaction,
                    action
                );
            }

            if (
                interaction.customId.startsWith(
                    "zenith_feedback_"
                )
            ) {
                const rating = Number(
                    interaction.customId.replace(
                        "zenith_feedback_",
                        ""
                    )
                );

                if (
                    rating < 1 ||
                    rating > 5
                ) return;

                saveFeedback(
                    interaction.guild?.id || "unknown",
                    interaction.user.id,
                    rating
                );

                return interaction.update({
                    content:
                        `⭐ Obrigado pelo seu feedback!\n\n` +
                        `Sua avaliação: **${rating}/5**`,
                    embeds: [],
                    components: []
                });
            }
        }
    } catch (error) {
        console.error(error);

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content:
                    "❌ Ocorreu um erro ao executar esta ação.",
                ephemeral: true
            }).catch(() => {});
        }
    }
});

process.on("unhandledRejection", error => {
    console.error("Unhandled rejection:", error);
});

client.login(process.env.DISCORD_TOKEN);
EOF

echo "[5/5] Instalando dependências..."

npm install

echo ""
echo "======================================"
echo "       ZENITH CRIADO COM SUCESSO"
echo "======================================"
echo ""
echo "Edite o token:"
echo "nano .env"
echo ""
echo "Depois execute:"
echo "npm start"
echo ""
