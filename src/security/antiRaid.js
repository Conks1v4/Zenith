const actions = new Map();

function registerAction(guildId, userId, type) {
  const key = `${guildId}:${userId}:${type}`;
  const now = Date.now();

  let data = actions.get(key);

  if (!data || now - data.time > 10000) {
    data = {
      time: now,
      count: 0
    };
  }

  data.count++;
  actions.set(key, data);

  return data.count;
}

module.exports = {
  registerAction
};
