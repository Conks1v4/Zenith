function isOwner(interaction) {
  return (
    interaction.guild &&
    interaction.user.id === interaction.guild.ownerId
  );
}

module.exports = {
  isOwner
};
