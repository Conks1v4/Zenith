const {
  SlashCommandBuilder
} = require("discord.js");

module.exports = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configura o Zenith no servidor"),

  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Sistema de tickets")
    .addSubcommand(s =>
      s.setName("painel")
        .setDescription("Envia o painel de tickets")
    )
    .addSubcommand(s =>
      s.setName("editar")
        .setDescription("Edita o painel de tickets")
    ),

  new SlashCommandBuilder()
    .setName("security")
    .setDescription("Configura a segurança do Zenith")
    .addSubcommand(s =>
      s.setName("antiraid")
        .setDescription("Ativa ou desativa o Anti-Raid")
        .addBooleanOption(o =>
          o.setName("ativar")
            .setDescription("Ativar proteção")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("antispam")
        .setDescription("Ativa ou desativa o Anti-Spam")
        .addBooleanOption(o =>
          o.setName("ativar")
            .setDescription("Ativar proteção")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("botprotection")
        .setDescription("Ativa ou desativa proteção contra bots")
        .addBooleanOption(o =>
          o.setName("ativar")
            .setDescription("Ativar proteção")
            .setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Gerencia a blacklist permanente")
    .addSubcommand(s =>
      s.setName("add")
        .setDescription("Adiciona alguém à blacklist")
        .addUserOption(o =>
          o.setName("usuario")
            .setDescription("Usuário")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("remove")
        .setDescription("Remove alguém da blacklist")
        .addUserOption(o =>
          o.setName("usuario")
            .setDescription("Usuário")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("list")
        .setDescription("Lista a blacklist")
    ),

  new SlashCommandBuilder()
    .setName("whitelist")
    .setDescription("Gerencia usuários protegidos")
    .addSubcommand(s =>
      s.setName("add")
        .setDescription("Adiciona à whitelist")
        .addUserOption(o =>
          o.setName("usuario")
            .setDescription("Usuário")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("remove")
        .setDescription("Remove da whitelist")
        .addUserOption(o =>
          o.setName("usuario")
            .setDescription("Usuário")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("list")
        .setDescription("Lista a whitelist")
    ),

  new SlashCommandBuilder()
    .setName("logs")
    .setDescription("Configura o canal de logs")
    .addChannelOption(o =>
      o.setName("canal")
        .setDescription("Canal que receberá os logs")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("lockdown")
    .setDescription("Ativa ou desativa o lockdown")
    .addBooleanOption(o =>
      o.setName("ativar")
        .setDescription("Ativar lockdown")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("info")
    .setDescription("Mostra informações do servidor")

].map(command => command.toJSON());