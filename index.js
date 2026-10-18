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
  eventNameIncludes: 'Подземелье Безумного Стаса',
  timezone: 'Europe/Moscow',
  dayReminderHour: 10,
  dayReminderMinute: 0,
};
// =======================================================

client.once(Events.ClientReady, () => {
  console.log(`✅ Бот запущен как ${client.user.tag}`);
  startCronJobs();
});

async function getScheduledEvents(guild) {
  const events = await guild.scheduledEvents.fetch();
  return [...events.values()]
    .filter(e => e.name.includes(CONFIG.eventNameIncludes))
    .sort((a, b) => a.scheduledStartTimestamp - b.scheduledStartTimestamp);
}

function getNextEvent(events) {
  const now = Date.now();
  return events.find(e => e.scheduledStartTimestamp > now) || null;
}

function getTodayEvent(events) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayEnd = todayStart + 24 * 60 * 60 * 1000;

  return events.find(e =>
    e.scheduledStartTimestamp >= todayStart &&
    e.scheduledStartTimestamp < todayEnd
  ) || null;
}

function ts(unixMs, style = 'F') {
  return `<t:${Math.floor(unixMs / 1000)}:${style}>`;
}

function getRoleMention() {
  return process.env.ROLE_ID ? `<@&${process.env.ROLE_ID}>` : '';
}

/**
 * Сообщение после 23:00 (следующее событие)
 */
async function sendNextEventMessage(channel, nextEvent) {
  if (!nextEvent) {
    await channel.send(`${getRoleMention()} ⚠️ Следующее событие «Подземелье Безумного Стаса» не найдено.`);
    return;
  }

  const link = `https://discord.com/events/${nextEvent.guildId}/${nextEvent.id}`;

  const content = [
    `${getRoleMention()} Следующее **Подземелье Безумного Стаса**`,
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
 * Напоминание в день игры (утром)
 */
async function sendDayReminder(channel, todayEvent) {
  if (!todayEvent) return;

  const link = `https://discord.com/events/${todayEvent.guildId}/${todayEvent.id}`;

  const content = [
    `${getRoleMention()} ${ts(todayEvent.scheduledStartTimestamp, 'F')} **Подземелье Безумного Стаса** — не забудьте.`,
    ``,
    `⏳ Начало ${ts(todayEvent.scheduledStartTimestamp, 'R')}`,
    `🔗 [Событие](${link})`,
  ].join('\n');

  await channel.send({ content });
}

/**
 * Напоминание за 1 час до начала
 */
async function sendOneHourReminder(channel, event) {
  if (!event) return;

  const link = `https://discord.com/events/${event.guildId}/${event.id}`;

  const content = [
    `${getRoleMention()} Через **1 час** начинается **Подземелье Безумного Стаса**!`,
    ``,
    `⏳ ${ts(event.scheduledStartTimestamp, 'R')}`,
    `🔗 [Событие](${link})`,
  ].join('\n');

  await channel.send({ content });
}

function startCronJobs() {
  // 1. Каждый день в 23:05 — если сегодня была игра → следующее событие
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

  // 2. Каждый день в 10:00 — если сегодня игра → утреннее напоминание
  cron.schedule(`${CONFIG.dayReminderMinute} ${CONFIG.dayReminderHour} * * *`, async () => {
    try {
      const guild = await client.guilds.fetch(process.env.GUILD_ID);
      const channel = await client.channels.fetch(process.env.CHANNEL_ID);
      const events = await getScheduledEvents(guild);

      const todayEvent = getTodayEvent(events);
      if (todayEvent) {
        console.log('Сегодня игра → отправляю утреннее напоминание');
        await sendDayReminder(channel, todayEvent);
      }
    } catch (err) {
      console.error('Ошибка в дневном cron:', err);
    }
  }, { timezone: CONFIG.timezone });

  // 3. Каждую минуту проверяем, нужно ли отправить напоминание за 1 час
  cron.schedule('* * * * *', async () => {
    try {
      const guild = await client.guilds.fetch(process.env.GUILD_ID);
      const channel = await client.channels.fetch(process.env.CHANNEL_ID);
      const events = await getScheduledEvents(guild);

      const now = Date.now();
      const oneHour = 60 * 60 * 1000;

      for (const event of events) {
        const timeUntilStart = event.scheduledStartTimestamp - now;

        // Если до начала осталось от 59 до 60 минут
        if (timeUntilStart > 59 * 60 * 1000 && timeUntilStart <= 60 * 60 * 1000) {
          console.log(`Отправляю напоминание за 1 час для события ${event.name}`);
          await sendOneHourReminder(channel, event);
        }
      }
    } catch (err) {
      console.error('Ошибка в проверке за 1 час:', err);
    }
  }, { timezone: CONFIG.timezone });

  console.log('Cron-задачи запущены');
}

// Команда /next
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
        content: `${getRoleMention()} Следующее: ${ts(next.scheduledStartTimestamp, 'F')} (${ts(next.scheduledStartTimestamp, 'R')})\n${link}`,
      });
    } catch (err) {
      console.error(err);
      await interaction.reply({ content: 'Произошла ошибка.', ephemeral: true });
    }
  }
});

client.login(process.env.TOKEN);