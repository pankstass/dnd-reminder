require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Events, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
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

function createEventLink(event) {
  return `https://discord.com/events/${event.guildId}/${event.id}`;
}

// ====================== АВТОМАТИЧЕСКИЕ СООБЩЕНИЯ ======================

async function sendNextEventMessage(channel, nextEvent) {
  if (!nextEvent) {
    await channel.send(`${getRoleMention()} ⚠️ Следующее событие «Подземелье Безумного Стаса» не найдено.`);
    return;
  }

  const content = [
    `${getRoleMention()} Следующее **Подземелье Безумного Стаса**`,
    ``,
    `📅 ${ts(nextEvent.scheduledStartTimestamp, 'F')}`,
    `⏳ ${ts(nextEvent.scheduledStartTimestamp, 'R')}`,
    ``,
    `🔗 [Открыть событие](${createEventLink(nextEvent)})`,
    ``,
    `Не забудьте отметить **Интересно**!`,
  ].join('\n');

  await channel.send({ content });
}

async function sendDayReminder(channel, todayEvent) {
  if (!todayEvent) return;

  const content = [
    `${getRoleMention()} ${ts(todayEvent.scheduledStartTimestamp, 'F')} **Подземелье Безумного Стаса** — не забудьте.`,
    ``,
    `⏳ Начало ${ts(todayEvent.scheduledStartTimestamp, 'R')}`,
    `🔗 [Событие](${createEventLink(todayEvent)})`,
  ].join('\n');

  await channel.send({ content });
}

async function sendOneHourReminder(channel, event) {
  if (!event) return;

  const content = [
    `${getRoleMention()} Через **1 час** начинается **Подземелье Безумного Стаса**!`,
    ``,
    `⏳ ${ts(event.scheduledStartTimestamp, 'R')}`,
    `🔗 [Событие](${createEventLink(event)})`,
  ].join('\n');

  await channel.send({ content });
}

function startCronJobs() {
  // 23:05 — следующее событие
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

  // 10:00 — утреннее напоминание
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

  // Каждую минуту — проверка напоминания за 1 час
  cron.schedule('* * * * *', async () => {
    try {
      const guild = await client.guilds.fetch(process.env.GUILD_ID);
      const channel = await client.channels.fetch(process.env.CHANNEL_ID);
      const events = await getScheduledEvents(guild);
      const now = Date.now();

      for (const event of events) {
        const timeUntilStart = event.scheduledStartTimestamp - now;
        if (timeUntilStart > 59 * 60 * 1000 && timeUntilStart <= 60 * 60 * 1000) {
          console.log(`Отправляю напоминание за 1 час: ${event.name}`);
          await sendOneHourReminder(channel, event);
        }
      }
    } catch (err) {
      console.error('Ошибка в проверке за 1 час:', err);
    }
  }, { timezone: CONFIG.timezone });

  console.log('Cron-задачи запущены');
}

// ====================== SLASH-КОМАНДЫ ======================

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  try {
    // ---------- /ping ----------
    if (commandName === 'ping') {
      const sent = await interaction.reply({ content: 'Проверяю...', fetchReply: true });
      const latency = sent.createdTimestamp - interaction.createdTimestamp;
      const apiLatency = Math.round(client.ws.ping);

      await interaction.editReply(
        `🏓 **Понг!**\n` +
        `Задержка бота: **${latency} мс**\n` +
        `Задержка API: **${apiLatency} мс**\n` +
        `Бот работает нормально ✅`
      );
    }

    // ---------- /next ----------
    else if (commandName === 'next') {
      const events = await getScheduledEvents(interaction.guild);
      const next = getNextEvent(events);

      if (!next) {
        return interaction.reply({ content: 'Следующее событие не найдено.', ephemeral: true });
      }

      const content = [
        `${getRoleMention()} **Следующее Подземелье Безумного Стаса**`,
        ``,
        `📅 ${ts(next.scheduledStartTimestamp, 'F')}`,
        `⏳ ${ts(next.scheduledStartTimestamp, 'R')}`,
        ``,
        `🔗 [Открыть событие](${createEventLink(next)})`,
      ].join('\n');

      await interaction.reply({ content });
    }

    // ---------- /today ----------
    else if (commandName === 'today') {
      const events = await getScheduledEvents(interaction.guild);
      const today = getTodayEvent(events);

      if (!today) {
        return interaction.reply({ content: 'На сегодня игр не запланировано.', ephemeral: true });
      }

      const content = [
        `${getRoleMention()} **Сегодня играет Подземелье Безумного Стаса**`,
        ``,
        `📅 ${ts(today.scheduledStartTimestamp, 'F')}`,
        `⏳ ${ts(today.scheduledStartTimestamp, 'R')}`,
        ``,
        `🔗 [Событие](${createEventLink(today)})`,
      ].join('\n');

      await interaction.reply({ content });
    }

    // ---------- /events ----------
    else if (commandName === 'events') {
      const events = await getScheduledEvents(interaction.guild);
      const upcoming = events.filter(e => e.scheduledStartTimestamp > Date.now()).slice(0, 5);

      if (upcoming.length === 0) {
        return interaction.reply({ content: 'Ближайших событий не найдено.', ephemeral: true });
      }

      const list = upcoming.map((e, i) => 
        `**${i + 1}.** ${ts(e.scheduledStartTimestamp, 'f')} — ${ts(e.scheduledStartTimestamp, 'R')}\n🔗 [Ссылка](${createEventLink(e)})`
      ).join('\n\n');

      const embed = new EmbedBuilder()
        .setTitle('📅 Ближайшие Подземелья Безумного Стаса')
        .setDescription(list)
        .setColor(0x5865F2)
        .setFooter({ text: `Всего найдено: ${upcoming.length}` });

      await interaction.reply({ embeds: [embed] });
    }

    // ---------- /time ----------
    else if (commandName === 'time') {
      const now = Date.now();
      await interaction.reply({
        content: `🕒 Текущее время (по настройкам бота):\n${ts(now, 'F')}\n\nЧасовой пояс: **${CONFIG.timezone}**`,
        ephemeral: true
      });
    }

    // ---------- /help ----------
    else if (commandName === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('📖 Команды бота')
        .setDescription('Список доступных команд:')
        .addFields(
          { name: '/next', value: 'Показать следующее событие' },
          { name: '/today', value: 'Информация о сегодняшней игре' },
          { name: '/events', value: 'Список ближайших событий' },
          { name: '/ping', value: 'Проверить, работает ли бот' },
          { name: '/time', value: 'Показать текущее время сервера' },
          { name: '/help', value: 'Показать это сообщение' },
        )
        .setColor(0x57F287);

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

  } catch (err) {
    console.error(`Ошибка в команде ${commandName}:`, err);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: 'Произошла ошибка при выполнении команды.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'Произошла ошибка при выполнении команды.', ephemeral: true });
    }
  }
});

client.login(process.env.TOKEN);