const {
  SlashCommandBuilder,
  EmbedBuilder
} = require("discord.js");

const {
  load,
  save
} = require("../database/database");

function formatDate(date) {
  return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
}

async function createInfoEmbed(guild) {
  // Atualiza o cache de membros antes de contar
  await guild.members.fetch().catch(() => {});

  const owner = await guild.fetchOwner().catch(() => null);

  const totalMembers = guild.memberCount;

  const bots = guild.members.cache.filter(
    member => member.user.bot
  ).size;

  const users = Math.max(
    totalMembers - bots,
    0
  );

  const channels = guild.channels.cache.size;

  const roles = Math.max(
    guild.roles.cache.size - 1,
    0
  );

  const boosts = guild.premiumSubscriptionCount || 0;

  const boostLevel = guild.premiumTier || 0;

  const icon = guild.iconURL({
    dynamic: true,
    size: 512
  });

  const embed = new EmbedBuilder()
    .setColor(0xFFFFFF)
    .setTitle(`ℹ️ Informações do Servidor`)
    .setDescription(
      `Informações atuais de **${guild.name}**`
    )
    .addFields(
      {
        name: "🏠 Servidor",
        value: `**${guild.name}**`,
        inline: true
      },
      {
        name: "🆔 ID",
        value: `\`${guild.id}\``,
        inline: true
      },
      {
        name: "👑 Dono",
        value: owner
          ? `<@${owner.id}>`
          : "Não encontrado",
        inline: true
      },
      {
        name: "📅 Criado em",
        value: formatDate(guild.createdAt),
        inline: false
      },
      {
        name: "👥 Membros",
        value: `**${totalMembers}**`,
        inline: true
      },
      {
        name: "👤 Usuários",
        value: `**${users}**`,
        inline: true
      },
      {
        name: "🤖 Bots",
        value: `**${bots}**`,
        inline: true
      },
      {
        name: "📁 Cargos",
        value: `**${roles}**`,
        inline: true
      },
      {
        name: "💬 Canais",
        value: `**${channels}**`,
        inline: true
      },
      {
        name: "🚀 Nível de Boost",
        value: `**Nível ${boostLevel}**`,
        inline: true
      },
      {
        name: "💎 Boosts",
        value: `**${boosts}**`,
        inline: true
      }
    )
    .setFooter({
      text: "Zenith • Atualização automática"
    })
    .setTimestamp();

  if (icon) {
    embed.setThumbnail(icon);
  }

  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("info")
    .setDescription("Mostra informações do servidor"),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({
        content:
          "❌ Este comando só pode ser usado dentro de um servidor.",
        ephemeral: true
      });
    }

    await interaction.deferReply();

    const embed = await createInfoEmbed(
      interaction.guild
    );

    const message = await interaction.editReply({
      embeds: [embed]
    });

    // Carrega o banco atual
    const db = load();

    // Garante a estrutura do servidor
    if (!db.servers) {
      db.servers = {};
    }

    if (!db.servers[interaction.guild.id]) {
      db.servers[interaction.guild.id] = {};
    }

    // Salva a mensagem do /info
    db.servers[interaction.guild.id].infoMessage = {
      channelId: interaction.channel.id,
      messageId: message.id
    };

    save(db);
  },

  createInfoEmbed
};