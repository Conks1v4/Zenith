async function kick(member, reason) {
  return member.kick(
    reason || "Zenith Moderation"
  );
}

module.exports = {
  kick
};
