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
      showTeamCalendars: true,
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
let included = false;
let revoked = false;
let member = true;
let connected = true;
let hangTeamRequests = false;
const mutations: unknown[] = [];
const teamReadLimits: string[] = [];
const teamMembers = [
  { userId: ALICE, sharing: 'all', coverage: 'ready' },
  { userId: BOB, sharing: 'busy_only', coverage: 'ready' },
];
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
const items = [
  {
    id: 'opaque-details',
    ownerId: ALICE,
    kind: 'details',
    time: time(10),
    contributesToAvailability: true,
    details: {
      title: 'Team planning',
      description: '<p>Review roadmap</p>',
      location: 'Room 2',
      conferenceUrl: 'https://meet.google.com/abc-defg-hij',
      organizerEmail: 'alice@example.com',
      organizerName: 'Alice',
      attendees: [
        {
          email: 'offline@example.com',
          displayName: 'Offline Fixture',
          isSelf: true,
          isOrganizer: false,
          responseStatus: 'accepted',
        },
      ],
      calendarName: 'Alice primary',
    },
  },
  {
    id: 'opaque-busy',
    ownerId: BOB,
    kind: 'busy',
    time: time(12),
    contributesToAvailability: true,
  },
  {
    id: 'opaque-point',
    ownerId: ALICE,
    kind: 'details',
    time: pointTime(13),
    contributesToAvailability: false,
    details: {
      title: 'Shared point',
      description: null,
      location: null,
      conferenceUrl: null,
      organizerEmail: null,
      organizerName: null,
      attendees: [],
      calendarName: 'Alice primary',
    },
  },
  {
    id: 'opaque-followed',
    ownerId: BOB,
    kind: 'busy',
    time: time(14),
    contributesToAvailability: false,
  },
];
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
  if (!connected && path === '/email/email/links')
    return respond({ links: [] });
  if (!connected && path === '/calendar/calendars')
    return respond({ calendars: [] });
  if (path === '/auth/team')
    return member
      ? respond({
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
        })
      : respond({}, 404);
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
          contributesToAvailability: true,
        },
        {
          calendarId: 'followed',
          name: 'Subscribed coworker',
          isPrimary: false,
          contributesToAvailability: included,
        },
      ],
    });
  if (path === '/calendar/availability-calendars/followed') {
    included = request.postDataJSON().contributesToAvailability;
    mutations.push(request.postDataJSON());
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
      ],
    });
  if (path === '/dss/calendar-events/team') {
    teamReadLimits.push(url.searchParams.get('limit') ?? 'default');
    if (hangTeamRequests) return new Promise<void>(() => {});
    return revoked
      ? respond({ message: 'Access revoked' }, 403)
      : respond({
          members: teamMembers,
          items: url.searchParams.get('limit') === '0' ? [] : items,
          nextCursor: null,
        });
  }
  if (path === '/dss/calendar-events/team-out-of-office')
    return respond({ items: [], hasMore: false });
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
      items: connected ? [ownPoint] : [],
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
  const titles = [
    'Alice Fixture: Team planning',
    'Bob Fixture: Busy',
    'Bob Fixture: Shared calendar block',
  ];
  await activePage
    .getByText(titles[2], { exact: true })
    .scrollIntoViewIfNeeded();
  for (const title of titles) {
    const chip = activePage.getByText(title, { exact: true });
    await expect(chip).toBeInViewport();
    await expect
      .poll(() =>
        chip.evaluate((element) => {
          for (
            let parent: Element | null = element;
            parent;
            parent = parent.parentElement
          ) {
            const style = getComputedStyle(parent);
            if (Number(style.opacity) === 0 || style.visibility === 'hidden')
              return false;
          }
          return true;
        })
      )
      .toBe(true);
  }
}

try {
  await page.goto(`${origin}/app/calendar/week`, {
    waitUntil: 'domcontentloaded',
  });
  await page
    .getByText('Team planning', { exact: false })
    .first()
    .waitFor({ timeout: 60000 });
  await expectRevealedCalendar();
  await expect.poll(() => teamReadLimits.includes('0')).toBe(true);
  assert.equal(teamReadLimits.includes('500'), true);
  assert.equal(teamReadLimits.includes('1'), false);
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
  const sharedPointChip = activeCalendar
    .getByText('Alice Fixture: Shared point', { exact: true })
    .locator(
      'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " fc-event ")][1]'
    );
  await expect(sharedPointChip).toBeInViewport();
  const sharedPointBounds = await sharedPointChip.boundingBox();
  assert.ok(
    sharedPointBounds &&
      sharedPointBounds.height > 0 &&
      sharedPointBounds.height < 30
  );
  await expect(sharedPointChip).not.toHaveClass(
    /fc-event-draggable|fc-event-resizable/
  );
  await sharedPointChip.click();
  await expect(
    page.locator('section[aria-label="Shared event details"]')
  ).toContainText('No duration');
  await expect(
    page.locator('section[aria-label="Shared event details"]')
  ).toContainText('Does not count toward their busy time');
  await page.screenshot({
    path: '/tmp/calendar-team-points.png',
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await page.getByText('Team planning', { exact: false }).first().click();
  const detail = page.locator('section[aria-label="Shared event details"]');
  await expect(detail).toContainText('Shared in Macro · Read only');
  await expect(detail).toContainText('Offline Fixture (you)');
  for (const name of [
    'Edit event',
    'Delete event',
    'Copy event',
    'Copy guest emails',
    'Email guests',
  ]) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(
      0
    );
  }
  assert.equal(
    new URL(page.url()).searchParams.has('s0.calendar.eventId'),
    false
  );
  await page.screenshot({
    path: '/tmp/calendar-team-details.png',
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await page
    .getByText(/: Busy$/, { exact: false })
    .first()
    .click();
  await expect(detail).toContainText('Counts toward this teammate');
  await expect(detail).not.toContainText('Organizer:');
  await expect(
    detail.getByRole('button', { name: 'Join meeting' })
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page
    .getByText(/: Shared calendar block$/, { exact: false })
    .first()
    .click();
  await expect(detail).toContainText('Does not count toward their busy time');
  await page.keyboard.press('Escape');

  await page.goto(`${origin}/app/settings/calendar`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(
    page.getByRole('radio', { name: 'Busy blocks', exact: true })
  ).toBeChecked({ timeout: 30000 });
  await expect(
    page.getByText(
      'including subscribed or delegated calendars, birthdays and holidays',
      {
        exact: false,
      }
    )
  ).toBeVisible();
  await expect(
    page.getByText(
      'Calendars unchecked in Google Calendar are included if synced.',
      {
        exact: false,
      }
    )
  ).toBeVisible();
  await expect(
    page.getByText(
      'Hiding a calendar in your Macro view does not change sharing.',
      {
        exact: false,
      }
    )
  ).toBeVisible();
  await page.screenshot({
    path: '/tmp/calendar-team-settings.png',
    fullPage: true,
  });
  await page.getByRole('radio', { name: 'Event details', exact: true }).check();
  await expect(
    page.getByRole('radio', { name: 'Event details', exact: true })
  ).toBeChecked();
  assert.equal(sharing, 'all');
  const availabilityToggle = page.getByRole('switch', {
    name: 'Count Subscribed coworker toward my availability',
  });
  await availabilityToggle.press('Space');
  await expect.poll(() => included).toBe(true);
  await expect(availabilityToggle).toBeChecked();
  await expect(availabilityToggle).toBeEnabled();
  await page.getByRole('radio', { name: 'Nothing', exact: true }).check();
  await expect.poll(() => sharing).toBe('none');
  await page.getByRole('radio', { name: 'Busy blocks', exact: true }).check();
  await expect.poll(() => sharing).toBe('busy_only');

  await page.goto(`${origin}/app/calendar/week`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByText('Team planning', { exact: false }).first().click();
  await expect(detail).toBeVisible();
  revoked = true;
  // A normal focus refresh must discard a now-forbidden range and detached popover.
  const focusTab = await context.newPage();
  await focusTab.bringToFront();
  await page.bringToFront();
  await focusTab.close();
  await expect(detail).toHaveCount(0, { timeout: 40000 });
  await expect(page.getByText('Team planning', { exact: false })).toHaveCount(
    0
  );
  await expect(
    page
      .getByText('Team calendars unavailable. Availability is unknown.', {
        exact: false,
      })
      .filter({ visible: true })
      .first()
  ).toBeVisible();
  revoked = false;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('Team planning', { exact: false }).first().click();
  await expect(detail).toBeVisible();
  member = false;
  const membershipTab = await context.newPage();
  await membershipTab.bringToFront();
  await page.bringToFront();
  await membershipTab.close();
  await expect(detail).toHaveCount(0, { timeout: 40000 });
  await expect(page.getByText('Team planning', { exact: false })).toHaveCount(
    0
  );
  assert.deepEqual(errors, []);
  member = true;
  connected = false;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(
    page.getByText('Team planning', { exact: false }).first()
  ).toBeVisible({ timeout: 30000 });
  await expectRevealedCalendar();
  await page.getByText('Team planning', { exact: false }).first().click();
  await expect(detail).toContainText('Shared in Macro · Read only');
  await page.screenshot({
    path: '/tmp/calendar-team-no-google.png',
    fullPage: true,
  });
  // Stay online but leave every new team read unresolved. The independent
  // expiry must remove already visible data and the detached popover anyway.
  hangTeamRequests = true;
  await expect(detail).toHaveCount(0, { timeout: 65000 });
  await expect(page.getByText('Team planning', { exact: false })).toHaveCount(
    0
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(requestFailures, []);
  console.log(
    'PASS: imported own/shared points and metadata-only edit, full-app team settings, sanitized blocks, read-only details, revoked-data removal, membership loss, viewer without Google, and expiry during hung refresh'
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
        teamReadLimits: [...new Set(teamReadLimits)],
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
