const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

function createPanel() {
  const embed = new EmbedBuilder()
    .setTitle("🎫 Suporte")
    .setDescription(
      "Clique em um botão abaixo para abrir um ticket."
    )
    .setColor(0x5865f2)
    .setFooter({
      text: "Zenith Tickets"
    });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("zenith_ticket_support")
      .setLabel("Suporte")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("zenith_ticket_denuncia")
      .setLabel("Denúncia")
      .setEmoji("🚨")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId("zenith_ticket_duvida")
      .setLabel("Dúvida")
      .setEmoji("❓")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("zenith_ticket_compras")
      .setLabel("Compras")
      .setEmoji("💰")
      .setStyle(ButtonStyle.Success)
  );

  return {
    embeds: [embed],
    components: [row]
  };
}

module.exports = {
  createPanel
};
