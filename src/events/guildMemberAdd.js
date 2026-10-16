
const { createWelcomeEmbed } = require('../embeds/welcomeEmbed');
const database = require('../database/database');

module.exports = {
  name: 'guildMemberAdd',

  async execute(member) {
    try {
      const data = await database.load();
      const server = data.servers?.[member.guild.id];
      const welcome = server?.welcome;

      if (!welcome?.enabled || !welcome.channelId) return;

      const channel = await member.guild.channels
        .fetch(welcome.channelId)
        .catch(() => null);

      if (!channel || !channel.isTextBased()) return;

      const embed = createWelcomeEmbed(
        member,
        welcome.message
      );

      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[ZENITH WELCOME] Erro:', error);
    }
  }
};
