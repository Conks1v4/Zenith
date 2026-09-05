const whitelist = new Map();

function add(guildId, userId) {
  if (!whitelist.has(guildId)) {
    whitelist.set(guildId, new Set());
  }

  whitelist.get(guildId).add(userId);
}

function remove(guildId, userId) {
  whitelist.get(guildId)?.delete(userId);
}

function has(guildId, userId) {
  return whitelist.get(guildId)?.has(userId) || false;
}

module.exports = {
  add,
  remove,
  has
};
