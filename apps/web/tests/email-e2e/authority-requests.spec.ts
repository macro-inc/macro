import { body, routeDraftId, watchDraftSaves } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import { backToList, deliverAll, openFromList } from './harness/ways-organise';
import { did } from './ledger/record';

for (const provider of PROVIDERS) {
  test.describe(`CRM request budget in ${anInbox(provider)}`, () => {
    test.use({ provider });

    // Opening personal threads, receiving socket frames and autosaving must not
    // turn each response or socket frame into another permission request.
    test('keeps permission reads constant through an email session', async ({
      page,
      mailbox,
    }, testInfo) => {
      let permissionReads = 0;
      let serviceRequests = 0;
      let frames = 0;
      let sendSoupUpdate: (() => void) | undefined;
      // This harness's HTTP recording proxy cannot relay WebSocket upgrades.
      // Serve valid Soup frames here; mailbox HTTP and permission reads still
      // go through the real services, without mocking the authority endpoint.
      await page.routeWebSocket(
        /\/items\/soup\/graphql\/ws(?:\?|$)/,
        (socket) => {
          socket.onMessage((message) => {
            const value = JSON.parse(String(message));
            if (value.type === 'connection_init')
              socket.send(JSON.stringify({ type: 'connection_ack' }));
            else if (value.type === 'ping')
              socket.send(JSON.stringify({ type: 'pong' }));
            else if (
              value.type === 'subscribe' &&
              value.payload.query.includes('subscription SoupUpdates')
            )
              sendSoupUpdate = () => {
                socket.send(
                  JSON.stringify({
                    id: value.id,
                    type: 'next',
                    payload: { data: { soupUpdates: [] } },
                  })
                );
                frames += 1;
              };
          });
        }
      );
      page.on('request', (request) => {
        const path = new URL(request.url()).pathname;
        if (path.endsWith('/crm/member-access')) permissionReads += 1;
        if (path.startsWith('/email/') || path.startsWith('/dss/'))
          serviceRequests += 1;
      });
      const checkpoints: Record<string, number> = {};
      const ids = await deliverAll(mailbox, ['Agenda', 'Planning']);
      await mailbox.open();
      await expect.poll(() => rowIds(page)).toContain(ids.Agenda);
      checkpoints.inbox = permissionReads;
      for (const subject of ['Agenda', 'Planning']) {
        await openFromList(page, ids[subject], `About ${subject}.`);
        await backToList(page);
      }
      checkpoints.threads = permissionReads;
      await expect.poll(() => Boolean(sendSoupUpdate)).toBe(true);
      for (let index = 0; index < 12; index++) sendSoupUpdate?.();
      expect(frames).toBe(12);
      checkpoints.realtime = permissionReads;

      const saves = watchDraftSaves(page);
      await page
        .getByRole('complementary', { name: 'Email navigation' })
        .getByRole('button', { name: 'New email' })
        .click();
      const to = page.getByRole('combobox').first();
      await to.fill('recipient@example.com');
      await to.press('Enter');
      did('AC-003');
      await page.getByPlaceholder(/subject/i).fill('Request budget draft');
      did('AC-018');
      await body(page).click();
      await page.keyboard.type('An authored message.');
      did('AC-022');
      await routeDraftId(page);
      await expect.poll(() => saves.length).toBeGreaterThan(0);
      await page.keyboard.type(' A second edit.');
      await expect.poll(() => saves.at(-1)?.html).toContain('A second edit.');
      checkpoints.autosave = permissionReads;
      const cacheGeneration = await page.evaluate(() => ({
        baselines: performance
          .getEntriesByName('macro.cache.generation-baseline')
          .map((entry) => (entry as PerformanceMark).detail),
        recoveries: performance
          .getEntriesByName('macro.cache.generation-recovery')
          .map((entry) => (entry as PerformanceMark).detail),
      }));
      await testInfo.attach('permission-request-counts', {
        body: JSON.stringify({
          permissionReads,
          serviceRequests,
          scriptedSoupFrames: frames,
          checkpoints,
          cacheGeneration,
        }),
        contentType: 'application/json',
      });
      // Boot plus one stale-generation retry is a constant budget. Main has no
      // member-access client and issues zero; the same journey compares both.
      expect(permissionReads).toBeLessThanOrEqual(2);
    });
  });
}
