
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType
} = require('discord.js');

const { createWelcomeEmbed } = require('../embeds/welcomeEmbed');
const database = require('../database/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Configure as boas-vindas do Zenith.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('configurar')
        .setDescription('Configure o canal e a mensagem.')
        .addChannelOption(option =>
          option.setName('canal')
            .setDescription('Canal de boas-vindas')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('mensagem')
            .setDescription('Use {user}, {server} e {count}.')
            .setMaxLength(1000)
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('testar')
        .setDescription('Teste a embed de boas-vindas.')
    )
    .addSubcommand(sub =>
      sub.setName('desativar')
        .setDescription('Desative as boas-vindas.')
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: 'Este comando só pode ser usado em um servidor.',
        ephemeral: true
      });
    }

    if (!interaction.memberPermissions.has(
      PermissionFlagsBits.Administrator
    )) {
      return interaction.reply({
        content: 'Você precisa ser administrador.',
        ephemeral: true
      });
    }

    const data = await database.load();
    data.servers ??= {};
    data.servers[interaction.guildId] ??= {};

    const server = data.servers[interaction.guildId];
    const action = interaction.options.getSubcommand();

    if (action === 'configurar') {
      const channel = interaction.options.getChannel('canal');
      const message = interaction.options.getString('mensagem');

      server.welcome = {
        enabled: true,
        channelId: channel.id,
        message: message ||
          'Esperamos que você se divirta com a gente!'
      };

      await database.save(data);

      return interaction.reply({
        content: `✅ Boas-vindas configuradas em ${channel}!\n\n` +
          'Variáveis disponíveis: `{user}`, `{server}` e `{count}`.',
        ephemeral: true
      });
    }

    if (action === 'desativar') {
      if (server.welcome) {
        server.welcome.enabled = false;
        await database.save(data);
      }

      return interaction.reply({
        content: '🔕 Sistema de boas-vindas desativado.',
        ephemeral: true
      });
    }

    if (action === 'testar') {
      const welcome = server.welcome;

      if (!welcome?.enabled || !welcome.channelId) {
        return interaction.reply({
          content: 'Configure as boas-vindas primeiro usando `/welcome configurar`.',
          ephemeral: true
        });
      }

      const channel = await interaction.guild.channels
        .fetch(welcome.channelId)
        .catch(() => null);

      if (!channel || !channel.isTextBased()) {
        return interaction.reply({
          content: 'O canal configurado não existe ou não está acessível.',
          ephemeral: true
        });
      }

      const embed = createWelcomeEmbed(
        interaction.member,
        welcome.message
      );

      return interaction.reply({
        content: 'Prévia da embed de boas-vindas:',
        embeds: [embed],
        ephemeral: true
      });
    }
  }
};
