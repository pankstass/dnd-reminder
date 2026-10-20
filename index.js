require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Events, EmbedBuilder, MessageFlags } = require('discord.js');
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
  eventIntervalDays: 14, // раз в две недели
};
// =======================================================

client.once(Events.ClientReady, () => {
  console.log(`✅ Бот запущен как ${client.user.tag}`);
  startCronJobs();
});

/**
 * Возвращает границы "сегодня" по Москве
 */
function getMoscowDayBounds() {
  const now = new Date();
  const moscowDateStr = now.toLocaleDateString('en-CA', { timeZone: CONFIG.timezone });
  const [year, month, day] = moscowDateStr.split('-').map(Number);

  // 00:00 по Москве = 21:00 предыдущего дня UTC
  const todayStart = Date.UTC(year, month - 1, day, 0, 0, 0) - (3 * 60 * 60 * 1000);
  const todayEnd = todayStart + 24 * 60 * 60 * 1000;

  return { todayStart, todayEnd };
}

async function getScheduledEvents(guild) {
  try {
    const events = await guild.scheduledEvents.fetch();
    const filtered = [...events.values()]
      .filter(e => e.name.includes(CONFIG.eventNameIncludes))
      .sort((a, b) => a.scheduledStartTimestamp - b.scheduledStartTimestamp);

    console.log(`[Events] Найдено событий: ${filtered.length}`);
    filtered.forEach(e => {
      console.log(`  - ${e.name} | ${new Date(e.scheduledStartTimestamp).toISOString()} | status: ${e.status}`);
    });

    return filtered;
  } catch (err) {
    console.error('[Events] Ошибка при получении событий:', err);
    return [];
  }
}

function getNextEvent(events) {
  const now = Date.now();
  return events.find(e => e.scheduledStartTimestamp > now) || null;
}

/**
 * Если Discord не вернул следующее событие — считаем +14 дней от последнего известного
 */
function calculateFallbackNextEvent(events) {
  if (events.length === 0) return null;

  // Берём самое позднее известное событие
  const lastKnown = events[events.length - 1];
  const nextTimestamp = lastKnown.scheduledStartTimestamp + (CONFIG.eventIntervalDays * 24 * 60 * 60 * 1000);

  // Создаём "виртуальный" объект события
  return {
    id: null,
    guildId: lastKnown.guildId,
    name: lastKnown.name,
    scheduledStartTimestamp: nextTimestamp,
    status: 1,
  };
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
  if (!event.id) {
    return null; // виртуальное событие — ссылки нет
  }
  return `https://discord.com/events/${event.guildId}/${event.id}`;
}

// ====================== СООБЩЕНИЯ ======================

async function sendNextEventMessage(channel, nextEvent) {
  if (!nextEvent) {
    await channel.send(`${getRoleMention()} ⚠️ Следующее событие «${CONFIG.eventNameIncludes}» не найдено.`);
    return;
  }

  const link = createEventLink(nextEvent);
  const linkLine = link ? `🔗 [Открыть событие](${link})` : `⚠️ Ссылка появится позже (событие ещё не создано Discord)`;

  const content = [
    `${getRoleMention()} Следующее **${CONFIG.eventNameIncludes}**`,
    ``,
    `📅 ${ts(nextEvent.scheduledStartTimestamp, 'F')}`,
    `⏳ ${ts(nextEvent.scheduledStartTimestamp, 'R')}`,
    ``,
    linkLine,
    ``,
    `Не забудьте отметить **Интересно**!`,
  ].join('\n');

  await channel.send({ content });
}

async function sendDayReminder(channel, todayEvent) {
  if (!todayEvent) return;

  const link = createEventLink(todayEvent);

  const content = [
    `${getRoleMention()} ${ts(todayEvent.scheduledStartTimestamp, 'F')} **${CONFIG.eventNameIncludes}** — не забудьте.`,
    ``,
    `⏳ Начало ${ts(todayEvent.scheduledStartTimestamp, 'R')}`,
    link ? `🔗 [Событие](${link})` : '',
  ].filter(Boolean).join('\n');

  await channel.send({ content });
}

async function sendOneHourReminder(channel, event) {
  if (!event) return;

  const link = createEventLink(event);

  const content = [
    `${getRoleMention()} Через **1 час** начинается **${CONFIG.eventNameIncludes}**!`,
    ``,
    `⏳ ${ts(event.scheduledStartTimestamp, 'R')}`,
    link ? `🔗 [Событие](${link})` : '',
  ].filter(Boolean).join('\n');

  await channel.send({ content });
}

// ====================== CRON ======================

function startCronJobs() {
  // 23:59 — анонс следующего события (ТОЛЬКО если сегодня была встреча)
cron.schedule('59 23 * * *', async () => {
  try {
    console.log('[Cron 23:59] Запуск задачи');
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const channel = await client.channels.fetch(process.env.CHANNEL_ID);
    const events = await getScheduledEvents(guild);

    const todayEvent = getTodayEvent(events);

    if (!todayEvent) {
      console.log('[Cron 23:59] Сегодня встречи не было — анонс не отправляем');
      return;
    }

    console.log('[Cron 23:59] Сегодня была встреча → ищем следующее событие');

    let nextEvent = getNextEvent(events.filter(e => e.id !== todayEvent.id));

    // Если Discord не вернул следующее — считаем вручную +14 дней
    if (!nextEvent) {
      console.log('[Cron 23:59] Следующее событие не найдено в API, используем расчёт +14 дней');
      nextEvent = calculateFallbackNextEvent(events);
    }

    await sendNextEventMessage(channel, nextEvent);
  } catch (err) {
    console.error('[Cron 23:59] Ошибка:', err);
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
          console.log(`[Cron 1h] Напоминание за 1 час: ${event.name}`);
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
    // Сразу подтверждаем взаимодействие, чтобы не получить Unknown interaction
    await interaction.deferReply();

    if (commandName === 'ping') {
      const latency = Date.now() - interaction.createdTimestamp;
      const apiLatency = Math.round(client.ws.ping);

      await interaction.editReply(
        `🏓 **Понг!**\nЗадержка бота: **${latency} мс**\nЗадержка API: **${apiLatency} мс**\nБот работает нормально ✅`
      );
    }

    else if (commandName === 'next') {
      const events = await getScheduledEvents(interaction.guild);
      let next = getNextEvent(events);

      if (!next) {
        next = calculateFallbackNextEvent(events);
      }

      if (!next) {
        return interaction.editReply('Следующее событие не найдено.');
      }

      const link = createEventLink(next);
      const linkLine = link
        ? `🔗 [Открыть событие](${link})`
        : `⚠️ Ссылка появится позже (событие ещё формирует Discord)`;

      const content = [
        `${getRoleMention()} **Следующее ${CONFIG.eventNameIncludes}**`,
        ``,
        `📅 ${ts(next.scheduledStartTimestamp, 'F')}`,
        `⏳ ${ts(next.scheduledStartTimestamp, 'R')}`,
        ``,
        linkLine,
      ].join('\n');

      await interaction.editReply({ content });
    }

    else if (commandName === 'today') {
      const events = await getScheduledEvents(interaction.guild);
      const today = getTodayEvent(events);

      if (!today) {
        return interaction.editReply('На сегодня событий не запланировано.');
      }

      const link = createEventLink(today);

      const content = [
        `${getRoleMention()} **Сегодня: ${CONFIG.eventNameIncludes}**`,
        ``,
        `📅 ${ts(today.scheduledStartTimestamp, 'F')}`,
        `⏳ ${ts(today.scheduledStartTimestamp, 'R')}`,
        link ? `🔗 [Событие](${link})` : '',
      ].filter(Boolean).join('\n');

      await interaction.editReply({ content });
    }

    else if (commandName === 'events') {
      const events = await getScheduledEvents(interaction.guild);
      const upcoming = events.filter(e => e.scheduledStartTimestamp > Date.now()).slice(0, 5);

      if (upcoming.length === 0) {
        return interaction.editReply('Ближайших событий не найдено.');
      }

      const list = upcoming.map((e, i) => {
        const link = createEventLink(e);
        return `**${i + 1}.** ${ts(e.scheduledStartTimestamp, 'f')} — ${ts(e.scheduledStartTimestamp, 'R')}${link ? `\n🔗 [Ссылка](${link})` : ''}`;
      }).join('\n\n');

      const embed = new EmbedBuilder()
        .setTitle('📅 Ближайшие события')
        .setDescription(list)
        .setColor(0x5865F2)
        .setFooter({ text: `Найдено: ${upcoming.length}` });

      await interaction.editReply({ embeds: [embed] });
    }

    else if (commandName === 'time') {
      const now = Date.now();
      await interaction.editReply(
        `🕒 Текущее время (по настройкам бота):\n${ts(now, 'F')}\n\nЧасовой пояс: **${CONFIG.timezone}**`
      );
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

      await interaction.editReply({ embeds: [embed] });
    }

  } catch (err) {
    console.error(`Ошибка в команде ${commandName}:`, err);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('Произошла ошибка при выполнении команды.');
      } else {
        await interaction.reply({ content: 'Произошла ошибка при выполнении команды.', flags: MessageFlags.Ephemeral });
      }
    } catch (e) {
      console.error('Не удалось отправить сообщение об ошибке:', e);
    }
  }
});

client.login(process.env.TOKEN);