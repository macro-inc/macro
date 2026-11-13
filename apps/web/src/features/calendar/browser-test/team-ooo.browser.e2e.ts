import { expect, type Page, type Route, test } from '@playwright/test';
import { openFixture, serveFromNode } from './serve-from-node';

const VIEWER = 'macro|viewer@example.com';
const BUSY_ONLY = 'macro|busy@example.com';
const SHARES_DETAILS = 'macro|open@example.com';

interface Absence {
  eventId: string;
  ownerId: string;
  title?: string;
  /** Days from today the all-day absence starts. */
  inDays: number;
}

const day = (inDays: number) =>
  new Date(Date.now() + inDays * 86_400_000).toISOString().slice(0, 10);

const item = (absence: Absence) => ({
  eventId: absence.eventId,
  occurrenceKey: 'single',
  ownerId: absence.ownerId,
  time: {
    kind: 'allDay',
    startDate: day(absence.inDays),
    endDate: day(absence.inDays + 2),
  },
  ...(absence.title === undefined ? {} : { title: absence.title }),
});

const TEAM_ABSENCES: Absence[] = [
  { eventId: 'event-busy', ownerId: BUSY_ONLY, inDays: 3 },
  {
    eventId: 'event-details',
    ownerId: SHARES_DETAILS,
    title: 'Hiking trip',
    inDays: 5,
  },
];

/** Answers the viewer's team: three members, the viewer among them. */
async function routeTeam(page: Page) {
  await serveFromNode(page);
  await page.route('**/auth/team', (route) =>
    route.fulfill({
      json: {
        team: { id: 'team-1', name: 'Example team' },
        members: [VIEWER, BUSY_ONLY, SHARES_DETAILS].map((user_id) => ({
          user_id,
        })),
      },
    })
  );
}

const OOO_ROUTE = '**/dss/calendar-events/team-out-of-office*';

const absences = (list: Absence[]) => ({
  json: { hasMore: false, items: list.map(item) },
});

test.describe('team out of office in the calendar sidebar', () => {
  // Class cal-team-ooo-overlay: when this fails, teammates' out-of-office
  // rows are replaced by a loading skeleton each time an unrelated calendar
  // of the viewer syncs, or a busy-only teammate's row shows a title.
  test('rows stay on screen while an unrelated sync reloads them, the busy-only one without a title', async ({
    page,
  }) => {
    await routeTeam(page);
    let reloading = false;
    let heldReload: ((route: Route) => void) | undefined;
    const reloadHeld = new Promise<Route>((resolve) => {
      heldReload = resolve;
    });
    await page.route(OOO_ROUTE, async (route) => {
      if (!reloading) return route.fulfill(absences(TEAM_ABSENCES));
      heldReload?.(route);
    });

    await openFixture(page, '/team-ooo.html');
    const busyRow = page.getByRole('button', { name: /Blake Busy/ });
    const detailsRow = page.getByRole('button', { name: /Olive Open/ });
    await expect(detailsRow).toContainText('Hiking trip');
    await expect(busyRow).toBeVisible();
    await expect(busyRow).not.toContainText('Out of office');
    await expect(page.getByRole('button')).toHaveCount(2);

    reloading = true;
    await page.evaluate(() =>
      window.calendarFixture.refreshCalendar({
        event: 'synced',
        link_id: 'link-unrelated',
        team_ooo_changed: false,
      })
    );
    const route = await reloadHeld;
    // The reload is in flight and unanswered: the rows are still the list.
    await expect(busyRow).toBeVisible();
    await expect(detailsRow).toContainText('Hiking trip');

    reloading = false;
    await route.fulfill(
      absences([
        ...TEAM_ABSENCES,
        {
          eventId: 'event-later',
          ownerId: SHARES_DETAILS,
          title: 'Conference',
          inDays: 20,
        },
      ])
    );
    await expect(
      page.getByRole('button', { name: /Conference/ })
    ).toBeVisible();
    await expect(busyRow).toBeVisible();
    await expect(busyRow).not.toContainText('Out of office');
  });

  // Class cal-team-ooo-overlay: when this fails, a failed request for the
  // team's absences reads as "nobody is out" instead of as a failure.
  test('a failed load says it could not load, not that nobody is out', async ({
    page,
  }) => {
    await routeTeam(page);
    await page.route(OOO_ROUTE, (route) =>
      route.fulfill({ status: 500, json: { message: 'unavailable' } })
    );

    await openFixture(page, '/team-ooo.html');

    await expect(page.getByText("Couldn't load time off")).toBeVisible();
    await expect(page.getByText(/No shared time off/)).toBeHidden();
  });
});
