require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Events, EmbedBuilder } = require('discord.js');
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

/**
 * Возвращает начало и конец "сегодня" по московскому времени
 */
function getMoscowDayBounds() {
  const now = new Date();

  // Получаем текущую дату в Москве в формате YYYY-MM-DD
  const moscowDateStr = now.toLocaleDateString('en-CA', { timeZone: CONFIG.timezone }); // 2026-10-19
  const [year, month, day] = moscowDateStr.split('-').map(Number);

  // Создаём начало дня в Москве (00:00:00)
  // Используем Date.UTC и потом корректируем, но проще через временную зону
  const startOfDayMoscow = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  // Москва = UTC+3 (без перехода на летнее в 2026)
  const offsetMs = 3 * 60 * 60 * 1000;
  const todayStart = startOfDayMoscow.getTime() - offsetMs;
  const todayEnd = todayStart + 24 * 60 * 60 * 1000;

  return { todayStart, todayEnd };
}

async function getScheduledEvents(guild) {
  const events = await guild.scheduledEvents.fetch();
  const filtered = [...events.values()]
    .filter(e => e.name.includes(CONFIG.eventNameIncludes))
    .sort((a, b) => a.scheduledStartTimestamp - b.scheduledStartTimestamp);

  console.log(`[Events] Найдено событий: ${filtered.length}`);
  filtered.forEach(e => {
    console.log(`  - ${e.name} | ${new Date(e.scheduledStartTimestamp).toISOString()} | status: ${e.status}`);
  });

  return filtered;
}

function getNextEvent(events) {
  const now = Date.now();
  // Берём ближайшее будущее событие со статусом SCHEDULED (или любое будущее)
  return events.find(e => e.scheduledStartTimestamp > now) || null;
}

function getTodayEvent(events) {
  const { todayStart, todayEnd } = getMoscowDayBounds();

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

// ====================== СООБЩЕНИЯ ======================

async function sendNextEventMessage(channel, nextEvent) {
  if (!nextEvent) {
    await channel.send(`${getRoleMention()} ⚠️ Следующее событие «${CONFIG.eventNameIncludes}» не найдено.`);
    return;
  }

  const content = [
    `${getRoleMention()} Следующее **${CONFIG.eventNameIncludes}**`,
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
    `${getRoleMention()} ${ts(todayEvent.scheduledStartTimestamp, 'F')} **${CONFIG.eventNameIncludes}** — не забудьте.`,
    ``,
    `⏳ Начало ${ts(todayEvent.scheduledStartTimestamp, 'R')}`,
    `🔗 [Событие](${createEventLink(todayEvent)})`,
  ].join('\n');

  await channel.send({ content });
}

async function sendOneHourReminder(channel, event) {
  if (!event) return;

  const content = [
    `${getRoleMention()} Через **1 час** начинается **${CONFIG.eventNameIncludes}**!`,
    ``,
    `⏳ ${ts(event.scheduledStartTimestamp, 'R')}`,
    `🔗 [Событие](${createEventLink(event)})`,
  ].join('\n');

  await channel.send({ content });
}

// ====================== CRON ======================

function startCronJobs() {
  // 23:05 — анонс следующего события
  cron.schedule('5 23 * * *', async () => {
    try {
      console.log('[Cron 23:05] Запуск задачи анонса следующего события');
      const guild = await client.guilds.fetch(process.env.GUILD_ID);
      const channel = await client.channels.fetch(process.env.CHANNEL_ID);
      const events = await getScheduledEvents(guild);

      const todayEvent = getTodayEvent(events);
      console.log('[Cron 23:05] Сегодняшнее событие:', todayEvent ? todayEvent.name : 'не найдено');

      // Всегда пытаемся найти следующее событие
      const nextEvent = getNextEvent(events.filter(e => !todayEvent || e.id !== todayEvent.id));
      console.log('[Cron 23:05] Следующее событие:', nextEvent ? new Date(nextEvent.scheduledStartTimestamp).toISOString() : 'не найдено');

      await sendNextEventMessage(channel, nextEvent);
    } catch (err) {
      console.error('[Cron 23:05] Ошибка:', err);
    }
  }, { timezone: CONFIG.timezone });

  // 10:00 — утреннее напоминание
  cron.schedule(`${CONFIG.dayReminderMinute} ${CONFIG.dayReminderHour} * * *`, async () => {
    try {
      console.log('[Cron 10:00] Запуск утреннего напоминания');
      const guild = await client.guilds.fetch(process.env.GUILD_ID);
      const channel = await client.channels.fetch(process.env.CHANNEL_ID);
      const events = await getScheduledEvents(guild);

      const todayEvent = getTodayEvent(events);
      if (todayEvent) {
        await sendDayReminder(channel, todayEvent);
      } else {
        console.log('[Cron 10:00] Сегодняшнего события нет');
      }
    } catch (err) {
      console.error('[Cron 10:00] Ошибка:', err);
    }
  }, { timezone: CONFIG.timezone });

  // Каждую минуту — проверка за 1 час
  cron.schedule('* * * * *', async () => {
    try {
      const guild = await client.guilds.fetch(process.env.GUILD_ID);
      const channel = await client.channels.fetch(process.env.CHANNEL_ID);
      const events = await getScheduledEvents(guild);
      const now = Date.now();

      for (const event of events) {
        const timeUntilStart = event.scheduledStartTimestamp - now;
        if (timeUntilStart > 59 * 60 * 1000 && timeUntilStart <= 60 * 60 * 1000) {
          console.log(`[Cron 1h] Отправляю напоминание за 1 час: ${event.name}`);
          await sendOneHourReminder(channel, event);
        }
      }
    } catch (err) {
      console.error('[Cron 1h] Ошибка:', err);
    }
  }, { timezone: CONFIG.timezone });

  console.log('Cron-задачи запущены');
}

// ====================== КОМАНДЫ ======================

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  try {
    if (commandName === 'ping') {
      const sent = await interaction.reply({ content: 'Проверяю...', fetchReply: true });
      const latency = sent.createdTimestamp - interaction.createdTimestamp;
      const apiLatency = Math.round(client.ws.ping);

      await interaction.editReply(
        `🏓 **Понг!**\nЗадержка бота: **${latency} мс**\nЗадержка API: **${apiLatency} мс**\nБот работает нормально ✅`
      );
    }

    else if (commandName === 'next') {
      const events = await getScheduledEvents(interaction.guild);
      const next = getNextEvent(events);

      if (!next) {
        return interaction.reply({ content: 'Следующее событие не найдено.', ephemeral: true });
      }

      const content = [
        `${getRoleMention()} **Следующее ${CONFIG.eventNameIncludes}**`,
        ``,
        `📅 ${ts(next.scheduledStartTimestamp, 'F')}`,
        `⏳ ${ts(next.scheduledStartTimestamp, 'R')}`,
        ``,
        `🔗 [Открыть событие](${createEventLink(next)})`,
      ].join('\n');

      await interaction.reply({ content });
    }

    else if (commandName === 'today') {
      const events = await getScheduledEvents(interaction.guild);
      const today = getTodayEvent(events);

      if (!today) {
        return interaction.reply({ content: 'На сегодня событий не запланировано.', ephemeral: true });
      }

      const content = [
        `${getRoleMention()} **Сегодня: ${CONFIG.eventNameIncludes}**`,
        ``,
        `📅 ${ts(today.scheduledStartTimestamp, 'F')}`,
        `⏳ ${ts(today.scheduledStartTimestamp, 'R')}`,
        ``,
        `🔗 [Событие](${createEventLink(today)})`,
      ].join('\n');

      await interaction.reply({ content });
    }

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
        .setTitle(`📅 Ближайшие события`)
        .setDescription(list)
        .setColor(0x5865F2)
        .setFooter({ text: `Всего найдено: ${upcoming.length}` });

      await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === 'time') {
      const now = Date.now();
      await interaction.reply({
        content: `🕒 Текущее время (по настройкам бота):\n${ts(now, 'F')}\n\nЧасовой пояс: **${CONFIG.timezone}**`,
        ephemeral: true
      });
    }

    else if (commandName === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('📖 Команды бота')
        .setDescription('Список доступных команд:')
        .addFields(
          { name: '/next', value: 'Показать следующее событие' },
          { name: '/today', value: 'Информация о сегодняшнем событии' },
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
    const msg = { content: 'Произошла ошибка при выполнении команды.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg);
    } else {
      await interaction.reply(msg);
    }
  }
});

client.login(process.env.TOKEN);