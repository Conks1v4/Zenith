async function protect(member) {
  if (!member.user.bot) return;

  console.log(
    `[SECURITY] Bot entrou: ${member.user.tag}`
  );
}

module.exports = {
  protect
};
