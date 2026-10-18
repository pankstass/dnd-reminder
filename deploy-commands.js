require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('next')
    .setDescription('Показать следующее Подземелье Безумного Стаса'),

  new SlashCommandBuilder()
    .setName('today')
    .setDescription('Информация о сегодняшней игре'),

  new SlashCommandBuilder()
    .setName('events')
    .setDescription('Список ближайших событий'),

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Проверить, работает ли бот'),

  new SlashCommandBuilder()
    .setName('time')
    .setDescription('Показать текущее время сервера'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Показать список всех команд'),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('Регистрирую slash-команды...');

    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands },
    );

    console.log('✅ Все команды успешно зарегистрированы!');
  } catch (error) {
    console.error('Ошибка при регистрации команд:', error);
  }
})();