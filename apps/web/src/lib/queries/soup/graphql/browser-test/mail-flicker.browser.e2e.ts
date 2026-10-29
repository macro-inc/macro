import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { SoupQueryVariables } from '../../../../service-clients/service-storage/graphql/generated/graphql';
import { CACHED_IDS, id, response, SERVER_IDS, STALE_IDS } from './fixtures';

function heldResponse() {
  return {
    requested: Promise.withResolvers<void>(),
    release: Promise.withResolvers<void>(),
  };
}

test('Noise never reintroduces repaired stale threads between cached and network renders', async ({
  page,
}, testInfo) => {
  const scope = `mail-flicker-${crypto.randomUUID()}`;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let network = heldResponse();
  let noiseRequests = 0;
  await page.route('**/__mail-flicker/graphql', async (route) => {
    const request: { variables: SoupQueryVariables } = route
      .request()
      .postDataJSON();
    const initial = request.variables.input.initial;
    const noise =
      initial?.emailView === 'INBOX' &&
      initial.filters?.emailFilter?.tree?.literal?.importance === false;
    if (noise) {
      noiseRequests += 1;
      const current = network;
      current.requested.resolve();
      await current.release.promise;
    }
    await route.fulfill({ json: { data: response(noise ? SERVER_IDS : []) } });
  });
  await page.goto(`/?scope=${scope}`);
  const rows = page.locator('[data-thread-id]');
  const list = page.locator('#mail-list');
  const expected = SERVER_IDS.map(id);

  // Positive control: on an unrepaired first visit, the observer must see the
  // stale local rows and their removal. This proves it can detect the flash.
  await network.requested.promise;
  await expect(rows).toHaveCount(CACHED_IDS.length);
  await page.evaluate(() => window.mailFlicker.startRecording());
  await page.evaluate(() => window.mailFlicker.releaseLocalReads());
  await expect(list).toHaveAttribute('data-source', 'local');
  network.release.resolve();
  await expect(list).toHaveAttribute('data-source', 'network');
  await expect(rows).toHaveCount(SERVER_IDS.length);
  const initial = await page.evaluate(() => window.mailFlicker.stopRecording());
  expect(
    initial.timeline.some((snapshot) =>
      STALE_IDS.every((n) => snapshot.ids.includes(id(n)))
    )
  ).toBe(true);
  expect(initial.timeline.at(-1)?.ids).toEqual(expected);

  const visits = [];
  for (const visit of ['first-return', 'second-return', 'opfs-reload']) {
    network = heldResponse();
    if (visit === 'opfs-reload') {
      await page.goto('about:blank');
      await page.goto(`/?scope=${scope}&seed=false`);
    } else {
      await page.getByRole('button', { name: 'Drafts', exact: true }).click();
      await expect(list).toHaveAttribute('data-tab', 'drafts');
      await expect(list).toHaveAttribute('data-source', 'network');
      await page.getByRole('button', { name: 'Inbox', exact: true }).click();
      await expect(list).toHaveAttribute('data-tab', 'signal');
      await expect(list).toHaveAttribute('data-source', 'network');
      await page.getByRole('button', { name: 'Noise', exact: true }).click();
    }
    await network.requested.promise;
    // First show the persisted server baseline. Then allow the real local
    // evaluation, while HTTP is still held. No fixed delay or frame sampling.
    await expect(rows).toHaveText(['Thread 20', 'Thread 16', 'Thread 8']);
    await page.evaluate(() => window.mailFlicker.startRecording());
    await page.evaluate(() => window.mailFlicker.releaseLocalReads());
    await expect(list).toHaveAttribute('data-source', 'local');
    const localIds = await rows.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-thread-id'))
    );
    network.release.resolve();
    await expect(list).toHaveAttribute('data-source', 'network');
    const observation = await page.evaluate(() =>
      window.mailFlicker.stopRecording()
    );
    visits.push({ visit, localIds, ...observation });
  }
  const evidence = testInfo.outputPath('rendered-row-transitions.json');
  await writeFile(evidence, JSON.stringify({ initial, visits }, null, 2));
  await testInfo.attach('rendered-row-transitions', {
    path: evidence,
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(noiseRequests).toBe(4);
  for (const observation of visits) {
    expect(observation.cacheErrors).toEqual([]);
    // Assert every recorded DOM state, not just an eventually correct list.
    // Without the Rust repair this is [server, server+stale, server].
    expect(
      observation.timeline.map((snapshot) => snapshot.ids),
      JSON.stringify(observation, null, 2)
    ).toEqual([expected]);
    expect(observation.localIds).toEqual(expected);
  }
});
