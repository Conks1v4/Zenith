const {
  SlashCommandBuilder,
  ChannelType
} = require("discord.js");

module.exports = [

  new SlashCommandBuilder()
    .setName("config")
    .setDescription("Abre o painel de configuração do Zenith"),

  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configura automaticamente o Zenith"),

  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Sistema de tickets")
    .addSubcommand(s =>
      s.setName("painel")
       .setDescription("Envia o painel de tickets"))
    .addSubcommand(s =>
      s.setName("editar")
       .setDescription("Edita o painel de tickets"))
    .addSubcommand(s =>
      s.setName("categoria")
       .setDescription("Define a categoria dos tickets")
       .addChannelOption(o =>
         o.setName("canal")
          .setDescription("Categoria dos tickets")
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(true))),

  new SlashCommandBuilder()
    .setName("security")
    .setDescription("Configura a segurança")
    .addSubcommand(s =>
      s.setName("antiraid")
       .setDescription("Liga ou desliga o Anti-Raid")
       .addBooleanOption(o =>
         o.setName("ativar")
          .setDescription("Ativar")
          .setRequired(true)))
    .addSubcommand(s =>
      s.setName("antispam")
       .setDescription("Liga ou desliga o Anti-Spam")
       .addBooleanOption(o =>
         o.setName("ativar")
          .setDescription("Ativar")
          .setRequired(true)))
    .addSubcommand(s =>
      s.setName("botprotection")
       .setDescription("Liga ou desliga a proteção contra bots")
       .addBooleanOption(o =>
         o.setName("ativar")
          .setDescription("Ativar")
          .setRequired(true))),

  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Blacklist permanente")
    .addSubcommand(s =>
      s.setName("add")
       .setDescription("Adiciona usuário")
       .addUserOption(o =>
         o.setName("usuario")
          .setDescription("Usuário")
          .setRequired(true)))
    .addSubcommand(s =>
      s.setName("remove")
       .setDescription("Remove usuário")
       .addUserOption(o =>
         o.setName("usuario")
          .setDescription("Usuário")
          .setRequired(true)))
    .addSubcommand(s =>
      s.setName("list")
       .setDescription("Lista usuários")),

  new SlashCommandBuilder()
    .setName("whitelist")
    .setDescription("Whitelist")
    .addSubcommand(s =>
      s.setName("add")
       .setDescription("Adiciona usuário")
       .addUserOption(o =>
         o.setName("usuario")
          .setDescription("Usuário")
          .setRequired(true)))
    .addSubcommand(s =>
      s.setName("remove")
       .setDescription("Remove usuário")
       .addUserOption(o =>
         o.setName("usuario")
          .setDescription("Usuário")
          .setRequired(true)))
    .addSubcommand(s =>
      s.setName("list")
       .setDescription("Lista usuários")),

  new SlashCommandBuilder()
    .setName("logs")
    .setDescription("Configura o canal de logs")
    .addChannelOption(o =>
      o.setName("canal")
       .setDescription("Canal de logs")
       .addChannelTypes(ChannelType.GuildText)
       .setRequired(true)),

  new SlashCommandBuilder()
    .setName("lockdown")
    .setDescription("Ativa ou desativa o lockdown")
    .addBooleanOption(o =>
      o.setName("ativar")
       .setDescription("Ativar")
       .setRequired(true)),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Bane um usuário")
    .addUserOption(o =>
      o.setName("usuario")
       .setDescription("Usuário")
       .setRequired(true))
    .addStringOption(o =>
      o.setName("motivo")
       .setDescription("Motivo")),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Expulsa um usuário")
    .addUserOption(o =>
      o.setName("usuario")
       .setDescription("Usuário")
       .setRequired(true))
    .addStringOption(o =>
      o.setName("motivo")
       .setDescription("Motivo")),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Adverte um usuário")
    .addUserOption(o =>
      o.setName("usuario")
       .setDescription("Usuário")
       .setRequired(true))
    .addStringOption(o =>
      o.setName("motivo")
       .setDescription("Motivo"))

].map(x => x.toJSON());
