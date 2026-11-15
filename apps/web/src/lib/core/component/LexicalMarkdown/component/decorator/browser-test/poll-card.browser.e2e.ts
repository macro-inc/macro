import { expect, test } from '@playwright/test';

const fixture =
  '/src/lib/core/component/LexicalMarkdown/component/decorator/browser-test/poll-card.html';

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 844 },
]) {
  for (const poll of ['Two options', 'Long question', 'Many options']) {
    test(`${poll} poll card keeps its reserved height through loading on ${viewport.name}`, async ({
      page,
    }) => {
      await page.route('https://**', (route) => route.abort());
      await page.setViewportSize(viewport);
      await page.goto(fixture);
      const section = page.getByRole('region', { name: poll, exact: true });
      const card = section.locator('[data-slot="card"]').first();
      await expect(card).toBeVisible({ timeout: 30_000 });
      const height = async () => (await card.boundingBox())!.height;
      // Before the preview loads, the reservation already holds the
      // question at its wrapped height.
      const reserved = await height();

      await section
        .getByRole('button', { name: `Load ${poll} preview` })
        .click();
      await expect(section.getByText('owner@example.com')).toBeVisible();
      expect(await height()).toBe(reserved);

      await section.getByRole('button', { name: `Load ${poll} form` }).click();
      await expect(section.getByText('Responses')).toBeVisible();
      expect(await height()).toBe(reserved);

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

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test(`a poll card shows its form block loading instead of an empty body on ${viewport.name}`, async ({
    page,
  }) => {
    await page.route('https://**', (route) => route.abort());
    // Hold the form block's code: the block stays suspended in its loading
    // state, as a card does while the form's code or detail is in flight.
    await page.route('**/src/features/block-form/form-block.tsx*', () => {});
    await page.clock.install();
    await page.setViewportSize(viewport);
    await page.goto(fixture);
    const section = page.getByRole('region', { name: 'Suspended' });
    await expect(section.getByText('owner@example.com')).toBeVisible({
      timeout: 30_000,
    });
    const loading = section.getByRole('status', { name: 'Loading form' });
    await expect(loading).toBeVisible();
    await loading.scrollIntoViewIfNeeded();
    // Painted, not clipped away: the loading state is what a person sees at
    // its center, and it has height.
    const box = (await loading.boundingBox())!;
    expect(box.height).toBeGreaterThan(40);
    const hit = await loading.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const top = document.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2
      );
      return !!top && element.contains(top);
    });
    expect(hit).toBe(true);

    // Code that never arrives says so and offers a reload, instead of a
    // skeleton that never ends.
    await page.clock.fastForward(10_000);
    await expect(section.getByText('Couldn’t load this form.')).toBeVisible();
    await expect(section.getByRole('button', { name: 'Reload' })).toBeVisible();
    await expect(loading).toHaveCount(0);
  });
}
