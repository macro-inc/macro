import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { bootstrapResponses } from '../native/fixtures/bootstrap';
import { USER_ID } from '../native/fixtures/mail';

// Full production components and routing, with API transport intercepted. Never uses real sessions.
const origin = process.env.CALENDAR_TEAM_BROWSER_URL ?? 'http://127.0.0.1:3037';
const sharedCdp = process.env.CALENDAR_TEAM_BROWSER_CDP;
const browser = sharedCdp
  ? await chromium.connectOverCDP(sharedCdp)
  : await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
      headless: true,
      args: ['--no-sandbox'],
    });
const context = await browser.newContext({
  viewport: { width: 1500, height: 1100 },
  timezoneId: 'UTC',
  serviceWorkers: 'block',
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors: string[] = [];
const requestFailures: string[] = [];
const unknown: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));

page.on('requestfailed', (request) => {
  const failure = request.failure()?.errorText;
  // Navigation and the deliberate expiry checks cancel fetches. Nonlocal
  // traffic is explicitly blocked by this synthetic harness below.
  if (!request.url().startsWith(origin) || failure === 'net::ERR_ABORTED')
    return;
  requestFailures.push(`${request.url()}: ${failure}`);
});
await context.addCookies([{ name: 'login', value: 'true', url: origin }]);
await page.addInitScript(() =>
  localStorage.setItem(
    'macro:pref:calendar:settings',
    JSON.stringify({
      periodView: 'timeGridWeek',
      hiddenSourceIds: [],
      sourceColors: {},
      accountColors: {},
      showWeekends: true,
      weekStartsOn: 0,
      timeFormat: '24-hour',
    })
  )
);
await page.routeWebSocket('**/*', (socket) => socket.close());
const ALICE = 'macro|alice@example.com';
const BOB = 'macro|bob@example.com';
const TEAM = '00000000-0000-0000-0000-000000001111';
let sharing = 'busy_only';
const included: Record<string, boolean> = { primary: true, followed: false };
const mutations: unknown[] = [];
const teamReads: string[] = [];
// Keep the browser clock live: calendar loading transitions compare elapsed time.
const fixtureDate = new Date().toISOString().slice(0, 10);
const time = (hour: number) => ({
  kind: 'timed',
  startsAt: `${fixtureDate}T${hour}:00:00Z`,
  endsAt: `${fixtureDate}T${hour + 1}:00:00Z`,
  timeZone: 'UTC',
});
const pointTime = (hour: number) => ({
  ...time(hour),
  endsAt: time(hour).startsAt,
});
const ownPoint = {
  event: {
    id: '00000000-0000-0000-0000-000000009001',
    ownerId: USER_ID,
    icalUid: 'synthetic-point',
    calendarId: 'primary',
    title: 'Imported point',
    time: pointTime(11),
    status: 'confirmed',
    eventType: 'default',
    transparency: 'opaque',
    visibility: 'default',
    isReadOnly: false,
    attendees: [],
    recurrenceLines: [],
    sources: [],
  },
  occurrence: {
    eventId: '00000000-0000-0000-0000-000000009001',
    occurrenceKey: pointTime(11).startsAt,
    recurrenceId: null,
    isCancelled: false,
    time: pointTime(11),
  },
};
const nextDate = new Date(Date.parse(fixtureDate) + 86_400_000)
  .toISOString()
  .slice(0, 10);
// Busy-only sharing withholds the title, so the chip falls back to "Out of office".
const bobOutOfOffice = {
  eventId: '00000000-0000-0000-0000-000000009002',
  occurrenceKey: fixtureDate,
  ownerId: BOB,
  time: { kind: 'allDay', startDate: fixtureDate, endDate: nextDate },
};
await page.route('**/*', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  const respond = (body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  if (url.origin !== origin) return route.abort();
  if (path.startsWith('/app') || path === '/') return route.continue();
  if (path === '/auth/jwt/refresh') return respond({});
  if (path === '/auth/team')
    return respond({
      team: {
        id: TEAM,
        name: 'Calendar fixtures',
        owner_id: USER_ID,
        slug: 'fixture',
        enterprise: false,
        crm_enabled: false,
        allow_non_admin_invites: true,
      },
      members: [USER_ID, ALICE, BOB].map((user_id) => ({
        user_id,
        team_id: TEAM,
        role: 'member',
        plan: 'free',
      })),
    });
  if (path === '/auth/user/get_names_with_email')
    return respond({
      names: [
        { id: USER_ID, first_name: 'Offline', last_name: 'Fixture' },
        { id: ALICE, first_name: 'Alice', last_name: 'Fixture' },
        { id: BOB, first_name: 'Bob', last_name: 'Fixture' },
      ],
    });
  if (path === '/calendar/team-sharing') {
    if (request.method() === 'PUT') {
      sharing = request.postDataJSON().sharing;
      mutations.push(request.postDataJSON());
    }
    return respond({ sharing });
  }
  if (path === '/calendar/availability-calendars')
    return respond({
      calendars: [
        {
          calendarId: 'primary',
          name: 'My primary',
          isPrimary: true,
          contributesToAvailability: included.primary,
        },
        {
          calendarId: 'followed',
          name: 'Subscribed coworker',
          isPrimary: false,
          contributesToAvailability: included.followed,
        },
      ],
    });
  const availabilityChange = path.match(
    /^\/calendar\/availability-calendars\/([^/]+)$/
  );
  if (availabilityChange) {
    included[availabilityChange[1]] =
      request.postDataJSON().contributesToAvailability;
    mutations.push({
      calendarId: availabilityChange[1],
      ...request.postDataJSON(),
    });
    return route.fulfill({ status: 204 });
  }
  if (path === '/calendar/calendars')
    return respond({
      calendars: [
        {
          id: 'primary',
          emailAddress: 'offline@example.com',
          emailLinkId: '00000000-0000-0000-0000-000000001000',
          name: 'My primary',
          isPrimary: true,
          isWritable: true,
          isSubscription: false,
          defaultReminders: [],
        },
        {
          id: 'followed',
          emailAddress: 'offline@example.com',
          emailLinkId: '00000000-0000-0000-0000-000000001000',
          name: 'Subscribed coworker',
          isPrimary: false,
          isWritable: false,
          isSubscription: false,
          defaultReminders: [],
        },
      ],
    });
  if (path === '/dss/calendar-events/team') {
    teamReads.push(url.search);
    return respond({}, 404);
  }
  if (path === '/dss/calendar-events/team-out-of-office')
    return respond({ items: [bobOutOfOffice], hasMore: false });
  if (
    path === `/calendar/events/${ownPoint.event.id}` &&
    request.method() === 'PATCH'
  ) {
    const body = request.postDataJSON();
    mutations.push({ eventPatch: body });
    if (body.title) ownPoint.event.title = body.title;
    return respond(ownPoint.event);
  }
  if (path === '/dss/calendar-events')
    return respond({
      items: [ownPoint],
      hasMore: false,
      nextCursor: null,
      syncStatus: 'ready',
    });
  const fixture = bootstrapResponses.get(`${request.method()} ${path}`);
  if (fixture) return respond(fixture.body, fixture.status);
  unknown.push(`${request.method()} ${path}`);
  return respond({}, 404);
});

async function expectRevealedCalendar() {
  const activePage = page
    .getByRole('region', { name: 'Calendar periods' })
    .locator('.pager-page[aria-hidden="false"]');
  // Playwright visibility checks accept opacity:0, so a DOM-only title assertion
  // can pass while FullCalendar intentionally conceals chips under its skeleton.
  await expect(
    activePage.locator('[data-calendar-loading-skeleton]')
  ).toHaveCount(0, { timeout: 15000 });
  await expect(
    activePage.locator(
      '[data-calendar-loading-state]:not([data-calendar-loading-state="hidden"])'
    )
  ).toHaveCount(0, { timeout: 15000 });
}

/** Record every loading placeholder that appears, however briefly. */
async function watchLoadingText() {
  await page.evaluate(() => {
    const seen: string[] = [];
    const placeholders = [
      'Loading your team…',
      'Loading calendars…',
      'Loading team calendar settings…',
    ];
    const check = () => {
      const text = document.body.innerText;
      for (const placeholder of placeholders)
        if (text.includes(placeholder)) seen.push(placeholder);
    };
    new MutationObserver(check).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    (window as unknown as { __loadingSeen: string[] }).__loadingSeen = seen;
  });
}

const loadingSeen = () =>
  page.evaluate(
    () => (window as unknown as { __loadingSeen: string[] }).__loadingSeen
  );

try {
  await page.goto(`${origin}/app/calendar/week`, {
    waitUntil: 'domcontentloaded',
  });
  await page
    .getByText('Imported point', { exact: true })
    .first()
    .waitFor({ timeout: 60000 });
  await expectRevealedCalendar();
  const sidebar = page.getByRole('complementary', {
    name: 'Calendar navigation',
  });
  await expect(sidebar.getByText('Calendars', { exact: true })).toBeVisible();
  await expect(page.getByText('Team calendars', { exact: true })).toHaveCount(
    0
  );
  await expect(
    page.getByRole('switch', { name: 'Show team calendars' })
  ).toHaveCount(0);
  await page.screenshot({
    path: '/tmp/calendar-team-grid.png',
    fullPage: true,
  });
  const activeCalendar = page
    .getByRole('region', { name: 'Calendar periods' })
    .locator('.pager-page[aria-hidden="false"]');
  const pointChip = activeCalendar
    .getByText('Imported point', { exact: true })
    .locator(
      'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " fc-event ")][1]'
    );
  await expect(pointChip).toBeInViewport();
  const pointBounds = await pointChip.boundingBox();
  assert.ok(
    pointBounds && pointBounds.height > 0 && pointBounds.height < 30,
    'Point must have a compact footprint, not an invented hour'
  );
  await expect(pointChip).not.toHaveClass(
    /fc-event-draggable|fc-event-resizable/
  );
  await expect(pointChip).toContainText('11:00');
  await expect(pointChip).not.toContainText('12:00');
  // Upcoming uses the exact point instant, and never treats it as ongoing.
  if (Date.now() < Date.parse(ownPoint.event.time.startsAt)) {
    await expect(
      page.getByRole('button', { name: 'Open Imported point', exact: true })
    ).toBeVisible();
  }
  await pointChip.click();
  await expect(page.getByText(/No duration/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Edit event', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('Imported point updated');
  await page.getByText('Add meeting link', { exact: true }).click();
  await page.getByRole('option', { name: 'Macro call', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Give this event a duration before adding a Macro call.'
  );
  assert.deepEqual(
    mutations,
    [],
    'Rejected point call must not save calendar changes'
  );
  await page.getByText('Macro call', { exact: true }).click();
  await page
    .getByRole('option', { name: 'No meeting link', exact: true })
    .click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(() =>
      mutations.some(
        (entry) =>
          typeof entry === 'object' && entry !== null && 'eventPatch' in entry
      )
    )
    .toBe(true);
  const savedPoint = mutations.find(
    (entry): entry is { eventPatch: Record<string, unknown> } =>
      typeof entry === 'object' && entry !== null && 'eventPatch' in entry
  );
  assert.equal(savedPoint?.eventPatch.title, 'Imported point updated');
  assert.equal('time' in (savedPoint?.eventPatch ?? {}), false);
  await expect(
    page.getByRole('textbox', { name: 'Title', exact: true })
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  mutations.length = 0;

  // The section checkbox hides only the grid overlay; the list keeps the row.
  const teamOooToggle = sidebar.getByRole('checkbox', {
    name: 'Show team out of office on the calendar',
  });
  const teamOooChip = activeCalendar.getByText('Bob Fixture: Out of office', {
    exact: true,
  });
  const teamOooRow = sidebar.getByRole('button', { name: /Bob Fixture/ });
  await expect(teamOooToggle).toBeChecked();
  await expect(teamOooChip).toBeVisible();
  await expect(teamOooRow).toBeVisible();
  await sidebar.getByTitle('Show on calendar').click();
  await expect(teamOooToggle).not.toBeChecked();
  await expect(teamOooChip).toHaveCount(0);
  await expect(teamOooRow).toBeVisible();
  assert.deepEqual(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('macro:pref:calendar:settings') ?? '{}')
          .hiddenSourceIds
    ),
    ['team-ooo'],
    'Hiding team out of office must persist with calendar visibility'
  );
  await page.screenshot({
    path: '/tmp/calendar-team-ooo-hidden.png',
    fullPage: true,
  });
  await sidebar.getByTitle('Show on calendar').click();
  await expect(teamOooToggle).toBeChecked();
  await expect(teamOooChip).toBeVisible();

  await page.goto(`${origin}/app/settings/calendar`, {
    waitUntil: 'domcontentloaded',
  });
  const sharingSelect = page.getByRole('button', {
    name: 'Share with teammates',
  });
  await expect(sharingSelect).toContainText('Busy blocks', { timeout: 30000 });
  await expect(
    page.getByText('Teammates see when you are busy, not what.', {
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByRole('switch', { name: 'Show team calendars' })
  ).toHaveCount(0);
  // The innermost section that holds the heading; the page nests sections.
  const busySection = page
    .locator('section')
    .filter({
      has: page.getByRole('heading', { name: 'Calendars that count as busy' }),
    })
    .last();
  const account = busySection.getByRole('checkbox', {
    name: 'offline@example.com',
    exact: true,
  });
  await expect
    .poll(() =>
      account.evaluate((element) => (element as HTMLInputElement).indeterminate)
    )
    .toBe(true);
  await busySection
    .getByRole('button', { name: 'Expand offline@example.com', exact: true })
    .click();
  const followed = busySection.getByRole('checkbox', {
    name: 'Subscribed coworker',
    exact: true,
  });
  await expect(
    busySection.getByRole('checkbox', { name: 'My primary' })
  ).toBeChecked();
  await expect(followed).not.toBeChecked();
  await page.screenshot({
    path: '/tmp/calendar-team-settings.png',
    fullPage: true,
  });

  await watchLoadingText();
  await sharingSelect.click();
  await page
    .getByRole('option', { name: 'Event details', exact: true })
    .click();
  await expect(sharingSelect).toContainText('Event details');
  await expect.poll(() => sharing).toBe('all');
  await expect(
    page.getByText(
      'Teammates see your events. Private events stay busy blocks.',
      { exact: true }
    )
  ).toBeVisible();
  await sharingSelect.click();
  await page.getByRole('option', { name: 'Nothing', exact: true }).click();
  await expect.poll(() => sharing).toBe('none');
  await busySection.getByText('Subscribed coworker', { exact: true }).click();
  await expect.poll(() => included.followed).toBe(true);
  await expect(followed).toBeChecked();
  await expect(account).toBeChecked();
  await busySection.getByText('offline@example.com', { exact: true }).click();
  await expect.poll(() => included.primary).toBe(false);
  await expect.poll(() => included.followed).toBe(false);
  await expect(account).not.toBeChecked();
  await sharingSelect.click();
  await page.getByRole('option', { name: 'Busy blocks', exact: true }).click();
  await expect.poll(() => sharing).toBe('busy_only');
  // Let the post-save refetches settle before checking for a flash.
  await page.waitForTimeout(1500);
  assert.deepEqual(
    await loadingSeen(),
    [],
    'Changing a setting must not flash a loading state'
  );
  await page.screenshot({
    path: '/tmp/calendar-team-settings-after.png',
    fullPage: true,
  });
  assert.deepEqual(teamReads, [], 'No surface reads teammate calendars');
  assert.deepEqual(errors, []);
  assert.deepEqual(requestFailures, []);
  console.log(
    'PASS: imported point rendering and metadata-only edit, team out-of-office overlay checkbox, no team calendar overlay or controls, team sharing select, account-grouped busy calendars, and settings changes without a loading flash'
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  console.log(
    JSON.stringify(
      {
        errors,
        requestFailures,
        unknown: [...new Set(unknown)],
        teamReads,
        mutations,
      },
      null,
      2
    )
  );
  try {
    await page.screenshot({
      path: '/tmp/calendar-team-final.png',
      fullPage: true,
    });
  } finally {
    // Closing a context cancels unrelated app preloads; those are cleanup, not
    // failures of the browser checks above.
    page.removeAllListeners('requestfailed');
    await context.close();
    if (!sharedCdp) await browser.close();
    else process.exit(process.exitCode ?? 0);
  }
}
