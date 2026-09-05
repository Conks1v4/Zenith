async function closeTicket(interaction) {
  await interaction.reply({
    content: "🔒 Este ticket será fechado.",
    ephemeral: true
  });

  setTimeout(() => {
    interaction.channel
      .delete("Zenith - Ticket fechado")
      .catch(() => {});
  }, 2000);
}

module.exports = {
  closeTicket
};
