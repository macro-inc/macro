import { expect, test } from '@playwright/test';

test('reaches a comment when loading layout interrupts the first smooth scroll', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('#viewport')!;
    const content = document.querySelector<HTMLElement>('#content')!;
    // Preserve the current text position across a loading reflow, as an
    // editor's layout anchoring does. Writing scrollTop interrupts Chromium's
    // native smooth animation even though the linked comment is still below.
    const interrupt = () => {
      if (viewport.scrollTop < 150) return;
      viewport.removeEventListener('scroll', interrupt);
      const top = viewport.scrollTop;
      content.style.paddingTop = '200px';
      viewport.scrollTop = top + 200;
      content.dataset.reflowed = 'true';
    };
    viewport.addEventListener('scroll', interrupt);
  });

  await page.getByRole('button', { name: 'Open comment' }).click();
  await expect(page.locator('#content')).toHaveAttribute(
    'data-reflowed',
    'true'
  );
  const target = page.locator('[data-message-id="target"]');
  await expect(target).toBeInViewport({ ratio: 1 });

  // Once reached, unrelated layout refreshes must not reclaim the scroll.
  await page.locator('#viewport').evaluate((viewport) => {
    viewport.scrollTo({ top: 0, behavior: 'instant' });
    const spacer = document.createElement('div');
    spacer.style.height = '100px';
    document.querySelector('#discussion')!.append(spacer);
  });
  await expect(target).not.toBeInViewport();

  await page.getByRole('button', { name: 'Open comment' }).click();
  await expect(target).toBeInViewport({ ratio: 1 });
});
