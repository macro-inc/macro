import { expect, type Page, test } from '@playwright/test';

const fixture =
  '/src/lib/core/component/LexicalMarkdown/component/decorator/browser-test/contact-mention.html';
const PERSON =
  'firstname.middlename.lastname.department@subdivision.example.com';

const LAYOUTS = [
  { name: 'desktop', query: '', touch: false, narrow: false },
  {
    name: 'a narrow desktop split',
    query: '?width=360',
    touch: false,
    narrow: true,
  },
  { name: 'phone', query: '', touch: true, narrow: true },
];

/** The message never scrolls sideways, and the chip's face stays inside it. */
async function expectFits(page: Page, label: string, truncates: boolean) {
  const section = page.getByRole('region', { name: label, exact: true });
  const chip = section.locator('[data-contact-mention]');
  await expect(chip).toBeVisible({ timeout: 30_000 });

  const layout = await section.evaluate((element) => {
    const pane = element.closest('[data-testid="pane"]')!;
    const body = element.querySelector('[data-message-content]')!;
    const face = element.querySelector('[data-contact-mention] > span')!;
    const name = face.lastElementChild!;
    const bodyBox = body.getBoundingClientRect();
    const faceBox = face.getBoundingClientRect();
    return {
      paneOverflow: pane.scrollWidth - pane.clientWidth,
      bodyOverflow: body.scrollWidth - body.clientWidth,
      faceInside:
        faceBox.left >= bodyBox.left - 0.5 &&
        faceBox.right <= bodyBox.right + 0.5,
      nameCut: name.scrollWidth > name.clientWidth,
    };
  });
  expect(layout).toEqual({
    paneOverflow: 0,
    bodyOverflow: 0,
    faceInside: true,
    nameCut: truncates,
  });

  // The truncation is pure CSS: the message keeps the height it mounted at.
  await expect(section.getByTestId('height-history')).toHaveText(/^\d+$/);
}

for (const layout of LAYOUTS) {
  test.describe(layout.name, () => {
    test.use(
      layout.touch
        ? {
            viewport: { width: 390, height: 844 },
            hasTouch: true,
            isMobile: true,
          }
        : { viewport: { width: 1280, height: 800 } }
    );

    test(`a long contact mention fits the message on ${layout.name}`, async ({
      page,
    }) => {
      await page.route('https://**', (route) => route.abort());
      await page.goto(`${fixture}${layout.query}`);
      // The person's address truncates only where the line is too short for it.
      await expectFits(page, 'Person', layout.narrow);
      await expectFits(page, 'Company', layout.narrow);

      if (layout.touch) return;
      // The hover card shows the whole address, wrapped inside the card.
      await page
        .getByRole('region', { name: 'Person', exact: true })
        .locator('[data-contact-mention]')
        .hover();
      // The address is both the card's name and its email line here.
      const lines = page.getByText(PERSON, { exact: true });
      await expect(lines).toHaveCount(2);
      for (const line of await lines.all()) {
        await expect(line).toBeVisible();
        const fits = await line.evaluate((element) => {
          const card = element.closest('.w-64')!.getBoundingClientRect();
          const box = element.getBoundingClientRect();
          return box.left >= card.left && box.right <= card.right;
        });
        expect(fits).toBe(true);
      }
    });
  });
}
