import { expect, test } from '@playwright/test';

const fixture =
  '/src/lib/core/component/LexicalMarkdown/component/decorator/browser-test/poll-card.html';

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 844 },
]) {
  for (const { poll, wraps } of [
    { poll: 'Two options', wraps: false },
    { poll: 'Long question', wraps: true },
    { poll: 'Many options', wraps: false },
  ]) {
    test(`${poll} poll card fits its content without moving on load on ${viewport.name}`, async ({
      page,
    }) => {
      await page.route('https://**', (route) => route.abort());
      await page.setViewportSize(viewport);
      await page.goto(fixture);
      const section = page.getByRole('region', { name: poll, exact: true });
      const card = section.locator('[data-slot="card"]').first();
      await expect(card).toBeVisible({ timeout: 30_000 });
      const reserved = (await card.boundingBox())!.height;

      await section.getByRole('button', { name: `Load ${poll}` }).click();
      await expect(section.getByText('Responses')).toBeVisible();
      const loaded = (await card.boundingBox())!.height;
      // One-line polls get exactly their space up front; wrapped text grows them.
      if (wraps) expect(loaded).toBeGreaterThan(reserved);
      else expect(loaded).toBe(reserved);

      // Nothing inside the card scrolls or is clipped: the "Poll" row and the
      // votes footer both sit within the card.
      const scrollers = await card.evaluate((element) =>
        [element, ...element.querySelectorAll('*')]
          // Screen-reader-only text is a 1px clip by design.
          .filter((node) => !node.classList.contains('sr-only'))
          .filter((node) => node.scrollHeight > node.clientHeight + 1)
          .filter((node) => getComputedStyle(node).overflowY !== 'visible')
          .map((node) => node.className)
      );
      expect(scrollers).toEqual([]);
      const box = (await card.boundingBox())!;
      for (const part of [
        section.getByText('Poll', { exact: true }),
        section.getByText(/votes? · one vote each/),
        section.getByText('Responses'),
      ]) {
        const partBox = (await part.boundingBox())!;
        expect(partBox.y).toBeGreaterThanOrEqual(box.y);
        expect(partBox.y + partBox.height).toBeLessThanOrEqual(
          box.y + box.height
        );
      }
    });
  }
}
