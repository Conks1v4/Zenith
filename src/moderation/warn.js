const warns = new Map();

function warn(guildId, userId, reason) {
  const key = `${guildId}:${userId}`;

  if (!warns.has(key)) {
    warns.set(key, []);
  }

  warns.get(key).push({
    reason,
    date: Date.now()
  });

  return warns.get(key).length;
}

module.exports = {
  warn
};
