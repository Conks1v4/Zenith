
const { EmbedBuilder } = require('discord.js');

function createWelcomeEmbed(member, customMessage) {
  const message = (customMessage || 'Esperamos que você se divirta com a gente!')
    .replace(/\{user\}/g, `<@${member.id}>`)
    .replace(/\{server\}/g, member.guild.name)
    .replace(/\{count\}/g, String(member.guild.memberCount));

  return new EmbedBuilder()
    .setColor('#5865F2')
    .setAuthor({
      name: 'ZENITH • BOAS-VINDAS',
      iconURL: member.client.user.displayAvatarURL()
    })
    .setTitle('👋 Temos um novo membro!')
    .setDescription(
      `Seja muito bem-vindo(a), <@${member.id}>!\n\n${message}`
    )
    .setThumbnail(member.user.displayAvatarURL({
      dynamic: true,
      size: 256
    }))
    .addFields(
      {
        name: '👤 Membro',
        value: `${member.user.username}`,
        inline: true
      },
      {
        name: '📊 Total de membros',
        value: `${member.guild.memberCount}`,
        inline: true
      }
    )
    .setFooter({
      text: `${member.guild.name} • Powered by Zenith`
    })
    .setTimestamp();
}

module.exports = { createWelcomeEmbed };
