const {
  ChannelType,
  PermissionFlagsBits
} = require("discord.js");

async function createTicket(interaction, type) {
  const existing = interaction.guild.channels.cache.find(
    channel =>
      channel.topic ===
      `Zenith Ticket | ${interaction.user.id}`
  );

  if (existing) {
    return interaction.reply({
      content: `❌ Você já possui um ticket: ${existing}`,
      ephemeral: true
    });
  }

  const channel =
    await interaction.guild.channels.create({
      name:
        `ticket-${interaction.user.username}`
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "")
          .slice(0, 90),

      type: ChannelType.GuildText,

      topic:
        `Zenith Ticket | ${interaction.user.id}`,

      permissionOverwrites: [
        {
          id: interaction.guild.id,
          deny: [
            PermissionFlagsBits.ViewChannel
          ]
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

  await channel.send(
    `🎫 **Ticket de ${type}**\n\n` +
    `${interaction.user}, explique seu problema.\n\n` +
    `🔒 Use o comando/botão de fechamento para encerrar.`
  );

  return interaction.reply({
    content: `✅ Ticket criado: ${channel}`,
    ephemeral: true
  });
}

module.exports = {
  createTicket
};
