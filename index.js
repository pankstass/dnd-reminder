require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const cron = require('node-cron');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildScheduledEvents,
    GatewayIntentBits.GuildMessages,
  ],
  partials: [Partials.GuildScheduledEvent],
});

// ====================== НАСТРОЙКИ ======================
const CONFIG = {
  eventNameIncludes: 'Подземелье Безумного Стаса', // часть названия события
  timezone: 'Europe/Moscow',                       // ваш часовой пояс
  afterEventHour: 23,                              // после скольки часов считать "конец дня"
  dayReminderHour: 10,                             // во сколько слать напоминание в день игры
  dayReminderMinute: 0,
};
// =======================================================

client.once(Events.ClientReady, () => {
  console.log(`✅ Бот запущен как ${client.user.tag}`);
  startCronJobs();
});

/**
 * Получает все запланированные события сервера
 */
async function getScheduledEvents(guild) {
  const events = await guild.scheduledEvents.fetch();
  return [...events.values()]
    .filter(e => e.name.includes(CONFIG.eventNameIncludes))
    .sort((a, b) => a.scheduledStartTimestamp - b.scheduledStartTimestamp);
}

/**
 * Находит следующее событие (ближайшее будущее)
 */
function getNextEvent(events) {
  const now = Date.now();
  return events.find(e => e.scheduledStartTimestamp > now) || null;
}

/**
 * Находит событие, которое должно пройти сегодня
 */
function getTodayEvent(events) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayEnd = todayStart + 24 * 60 * 60 * 1000;

  return events.find(e =>
    e.scheduledStartTimestamp >= todayStart &&
    e.scheduledStartTimestamp < todayEnd
  ) || null;
}

/**
 * Формирует Discord timestamp
 */
function ts(unixMs, style = 'F') {
  return `<t:${Math.floor(unixMs / 1000)}:${style}>`;
}

/**
 * Сообщение после окончания текущей игры (после 23:00)
 */
async function sendNextEventMessage(channel, nextEvent) {
  if (!nextEvent) {
    await channel.send('⚠️ Следующее событие «Подземелье Безумного Стаса» не найдено.');
    return;
  }

  const link = `https://discord.com/events/${nextEvent.guildId}/${nextEvent.id}`;
  const roleMention = process.env.ROLE_ID ? `<@&${process.env.ROLE_ID}>` : '';

  const content = [
    `${roleMention} Следующее **Подземелье Безумного Стаса**`,
    ``,
    `📅 ${ts(nextEvent.scheduledStartTimestamp, 'F')}`,
    `⏳ ${ts(nextEvent.scheduledStartTimestamp, 'R')}`,
    ``,
    `🔗 [Открыть событие](${link})`,
    ``,
    `Не забудьте отметить **Интересно**!`,
  ].join('\n');

  await channel.send({ content });
}

/**
 * Напоминание в день игры
 */
async function sendDayReminder(channel, todayEvent) {
  if (!todayEvent) return;

  const link = `https://discord.com/events/${todayEvent.guildId}/${todayEvent.id}`;
  const roleMention = process.env.ROLE_ID ? `<@&${process.env.ROLE_ID}>` : '';

  const content = [
    `${roleMention} ${ts(todayEvent.scheduledStartTimestamp, 'F')} **Подземелье Безумного Стаса** — не забудьте.`,
    ``,
    `⏳ Начало ${ts(todayEvent.scheduledStartTimestamp, 'R')}`,
    `🔗 [Событие](${link})`,
  ].join('\n');

  await channel.send({ content });
}

/**
 * Запуск cron-задач
 */
function startCronJobs() {
  // 1. Каждый день в 23:05 — если сегодня была игра, отправляем следующее событие
  cron.schedule('5 23 * * *', async () => {
    try {
      const guild = await client.guilds.fetch(process.env.GUILD_ID);
      const channel = await client.channels.fetch(process.env.CHANNEL_ID);
      const events = await getScheduledEvents(guild);

      const todayEvent = getTodayEvent(events);
      if (todayEvent) {
        console.log('Сегодня была игра → отправляю следующее событие');
        const nextEvent = getNextEvent(events.filter(e => e.id !== todayEvent.id));
        await sendNextEventMessage(channel, nextEvent);
      }
    } catch (err) {
      console.error('Ошибка в 23:05 cron:', err);
    }
  }, { timezone: CONFIG.timezone });

  // 2. Каждый день в 10:00 — если сегодня игра, шлём напоминание
  cron.schedule(`${CONFIG.dayReminderMinute} ${CONFIG.dayReminderHour} * * *`, async () => {
    try {
      const guild = await client.guilds.fetch(process.env.GUILD_ID);
      const channel = await client.channels.fetch(process.env.CHANNEL_ID);
      const events = await getScheduledEvents(guild);

      const todayEvent = getTodayEvent(events);
      if (todayEvent) {
        console.log('Сегодня игра → отправляю напоминание');
        await sendDayReminder(channel, todayEvent);
      }
    } catch (err) {
      console.error('Ошибка в дневном cron:', err);
    }
  }, { timezone: CONFIG.timezone });

  console.log('Cron-задачи запущены');
}

// Ручная команда /next
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'next') {
    try {
      const guild = interaction.guild;
      const events = await getScheduledEvents(guild);
      const next = getNextEvent(events);

      if (!next) {
        return interaction.reply({ content: 'Следующее событие не найдено.', ephemeral: true });
      }

      const link = `https://discord.com/events/${next.guildId}/${next.id}`;
      await interaction.reply({
        content: `Следующее: ${ts(next.scheduledStartTimestamp, 'F')} (${ts(next.scheduledStartTimestamp, 'R')})\n${link}`,
        ephemeral: true,
      });
    } catch (err) {
      console.error(err);
      await interaction.reply({ content: 'Произошла ошибка.', ephemeral: true });
    }
  }
});

client.login(process.env.TOKEN);