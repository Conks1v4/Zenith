const users = new Map();

function checkSpam(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const now = Date.now();

  let data = users.get(key);

  if (!data || now - data.time > 5000) {
    data = {
      time: now,
      count: 0
    };
  }

  data.count++;
  users.set(key, data);

  return data.count;
}

module.exports = {
  checkSpam
};
