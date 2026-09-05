async function ban(member, reason) {
  return member.ban({
    reason: reason || "Zenith Moderation"
  });
}

module.exports = {
  ban
};
