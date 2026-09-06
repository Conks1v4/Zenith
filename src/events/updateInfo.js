const { load } = require("../database");

const {
  createInfoEmbed
} = require("../commands/info");

async function updateServerInfo(guild) {
  try {
    if (!guild) return;

    const db = load();

    if (!db.servers) return;

    const serverData = db.servers[guild.id];

    if (!serverData) return;

    if (!serverData.infoMessage) return;

    const {
      channelId,
      messageId
    } = serverData.infoMessage;

    const channel = await guild.channels
      .fetch(channelId)
      .catch(() => null);

    if (!channel) return;

    if (!channel.isTextBased()) return;

    const message = await channel.messages
      .fetch(messageId)
      .catch(() => null);

    if (!message) return;

    const embed = await createInfoEmbed(guild);

    await message.edit({
      embeds: [embed]
    });

  } catch (error) {
    console.error(
      `[ZENITH] Erro ao atualizar /info:`,
      error
    );
  }
}

module.exports = {
  updateServerInfo
};