const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require("discord.js");

async function sendFeedback(user, ticketName) {
  const row = new ActionRowBuilder();

  for (let i = 1; i <= 5; i++) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`zenith_feedback_${i}`)
        .setLabel(String(i))
        .setEmoji("⭐")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  const embed = new EmbedBuilder()
    .setTitle("⭐ Avalie seu atendimento")
    .setDescription(
      `O ticket **${ticketName}** foi fechado.\n\n` +
      `Escolha uma nota de 1 a 5 estrelas.`
    )
    .setColor(0xf1c40f);

  await user.send({
    embeds: [embed],
    components: [row]
  }).catch(() => {});
}

module.exports = {
  sendFeedback
};
