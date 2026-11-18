import { expect, test } from '@playwright/test';

test('the real source slash menu retains default and overridden action execution', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(
    '/src/lib/core/component/LexicalMarkdown/component/menu/ActionsMenu/browser-test/control.html'
  );
  const editor = page.getByRole('textbox', { name: 'Source editor' });
  await editor.click();
  await editor.pressSequentially('/h2');
  await page.getByText('Heading 2', { exact: true }).click();
  await expect(page.getByTestId('state')).toContainText('"tag":"h2"');
  await expect(editor).toHaveText('');
  await page.getByRole('button', { name: 'Reset editor' }).click();
  await editor.pressSequentially('/custom');
  await page.getByText('Custom quote', { exact: true }).click();
  await expect(page.getByTestId('state')).toContainText('"type":"quote"');
  await expect(editor).toHaveText('');
  expect(errors).toEqual([]);
});
