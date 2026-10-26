import { expect, test } from '@playwright/test';

const fixture =
  '/src/lib/core/component/LexicalMarkdown/component/decorator/browser-test/task-status.html';

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`task rows and mentions update together on ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(fixture);
    await expect(
      page
        .getByTestId('static-task-mention')
        .getByRole('img', { name: 'Task: Not started', exact: true })
    ).toBeVisible();
    for (const status of [
      'Not started',
      'In progress',
      'In review',
      'Completed',
      'Canceled',
    ]) {
      await expect(
        page
          .getByRole('region', { name: 'Completion flag only', exact: true })
          .getByRole('img', { name: 'Task: Completed', exact: true })
      ).toHaveCount(2);
      await expect(
        page
          .getByRole('region', { name: 'Unknown status', exact: true })
          .getByRole('img', { name: 'Task: Not started', exact: true })
      ).toHaveCount(2);
      const example = page.getByRole('region', { name: status, exact: true });
      await expect(
        example.getByRole('img', { name: `Task: ${status}`, exact: true })
      ).toHaveCount(2);
    }
    const example = page.getByRole('region', {
      name: 'In progress',
      exact: true,
    });
    await example
      .getByRole('button', { name: 'Complete', exact: true })
      .click();
    await expect(
      example.getByRole('img', { name: 'Task: Completed', exact: true })
    ).toHaveCount(2);
    await example.getByRole('button', { name: 'Reopen', exact: true }).click();
    await expect(
      example.getByRole('img', { name: 'Task: Not started', exact: true })
    ).toHaveCount(2);
  });
}
