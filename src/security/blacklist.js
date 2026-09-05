const blacklist = new Map();

function add(guildId, userId, reason) {
  if (!blacklist.has(guildId)) {
    blacklist.set(guildId, new Map());
  }

  blacklist.get(guildId).set(userId, {
    reason,
    date: Date.now()
  });
}

function remove(guildId, userId) {
  blacklist.get(guildId)?.delete(userId);
}

function has(guildId, userId) {
  return blacklist.get(guildId)?.has(userId) || false;
}

module.exports = {
  add,
  remove,
  has
};
