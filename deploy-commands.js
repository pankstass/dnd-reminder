require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('next')
    .setDescription('Показать следующее Подземелье Безумного Стаса'),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('Начинаю регистрацию slash-команд...');

    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands },
    );

    console.log('✅ Slash-команды успешно зарегистрированы!');
  } catch (error) {
    console.error('Ошибка при регистрации команд:', error);
  }
})();