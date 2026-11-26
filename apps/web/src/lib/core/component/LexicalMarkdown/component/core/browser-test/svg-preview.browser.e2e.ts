import { expect, type Locator, type Page, test } from '@playwright/test';

declare global {
  interface Window {
    svgPreviewHandlers: string[];
  }
}

async function expectPreviewDrawnInert(page: Page, section: Locator) {
  await expect(section.getByRole('switch', { name: 'Preview' })).toBeChecked();
  expect(await page.evaluate(() => window.svgPreviewHandlers)).toEqual([]);

  // The SVG is drawn as a picture, not mounted into the page.
  const image = section.getByRole('img', { name: 'SVG preview' });
  await expect(image).toBeVisible();
  const size = await image.evaluate(async (element: HTMLImageElement) => {
    await element.decode();
    return [element.naturalWidth, element.naturalHeight];
  });
  expect(size).toEqual([120, 80]);
  await expect(section.locator('[onload], [onerror], [onbegin]')).toHaveCount(
    0
  );
  expect(await page.evaluate(() => window.svgPreviewHandlers)).toEqual([]);
}

// Switch inputs are visually hidden behind their track, so use the keyboard.
async function turnOnPreview(section: Locator) {
  const toggle = section.getByRole('switch', { name: 'Preview' });
  await toggle.focus();
  await toggle.press('Space');
}

test.beforeEach(async ({ page, context }) => {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost') await route.continue();
    else await route.abort();
  });
  await page.goto(
    '/src/lib/core/component/LexicalMarkdown/component/core/browser-test/svg-preview.html'
  );
});

test('SVG code previews draw the picture and run none of its handlers', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  // A document saved with its preview on opens previewed.
  await expectPreviewDrawnInert(page, page.getByTestId('document'));

  // A message's code block previews when the reader turns it on.
  const message = page.getByTestId('message');
  await turnOnPreview(message);
  await expectPreviewDrawnInert(page, message);

  expect(errors).toEqual([]);
});

test('an SVG drawn in currentColor takes the text colour around its preview', async ({
  page,
}) => {
  const icon = page.getByTestId('icon');
  await turnOnPreview(icon);
  const image = icon.getByRole('img', { name: 'SVG preview' });
  await expect(image).toBeVisible();

  const [drawn, text] = await image.evaluate(
    async (element: HTMLImageElement) => {
      await element.decode();
      const firstPixel = (
        paint: (context: CanvasRenderingContext2D) => void
      ) => {
        const context = document.createElement('canvas').getContext('2d');
        if (!context) throw new Error('no 2d canvas');
        paint(context);
        return [...context.getImageData(0, 0, 1, 1).data];
      };
      const color = getComputedStyle(element).color;
      return [
        firstPixel((context) => context.drawImage(element, 0, 0)),
        firstPixel((context) => {
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
        }),
      ];
    }
  );
  // The fixture uses the dark theme, where a lost currentColor draws black.
  expect(text).not.toEqual([0, 0, 0, 255]);
  expect(drawn).toEqual(text);
});
