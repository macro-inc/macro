import { expect, test } from '@playwright/test';
import { signatureHtml } from './sample';
import type {} from './services';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('region', { name: 'Signature preview for alex@example.com' })
  ).toBeVisible();
});

test('saved HTML keeps its nested layout in settings and new-message previews', async ({
  page,
}) => {
  const preview = page.getByRole('region', {
    name: 'Signature preview for alex@example.com',
  });
  await expect(preview.locator('table')).toHaveCount(3);
  await expect(preview.locator('table table')).toHaveCount(2);
  await expect(preview.locator('td').first()).toHaveCSS(
    'border-top-width',
    '0px'
  );
  const name = preview.getByText('Alex Morgan');
  const title = preview.getByText('Brand and Marketing Strategist');
  const nameBox = await name.boundingBox();
  const titleBox = await title.boundingBox();
  expect(nameBox && titleBox && nameBox.y < titleBox.y).toBeTruthy();
  await page.getByRole('button', { name: 'Signature', exact: true }).click();
  const outgoing = page.getByRole('region', {
    name: 'Signature preview',
    exact: true,
  });
  await expect(outgoing.locator('table')).toHaveCount(3);
  expect(
    await outgoing.evaluate((element) => element.shadowRoot?.innerHTML)
  ).toBe(await preview.evaluate((element) => element.shadowRoot?.innerHTML));
  await page.getByRole('button', { name: 'Leave settings' }).click();
  await page.getByRole('button', { name: 'Reopen settings' }).click();
  await expect(preview.locator('table')).toHaveCount(3);
  expect(
    await page.evaluate(() => window.signatureFixture.readState().patches)
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
});

test('import, HTML edits, save, and reopening preserve the future signature', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Signature editing is desktop-only');
  await page.getByRole('button', { name: 'Import from Gmail' }).click();
  await expect(page.getByRole('status')).toHaveText(
    'Signature imported from Gmail'
  );
  expect(
    await page.evaluate(
      () => window.signatureFixture.readState().savedSignature
    )
  ).toBe(signatureHtml);
  await page.getByRole('tab', { name: 'Rich text' }).click();
  await page.getByRole('button', { name: 'Continue to rich text' }).click();
  await page.getByRole('button', { name: 'Import from Gmail' }).click();
  await expect(
    page.getByRole('region', { name: 'Signature preview for alex@example.com' })
  ).toBeVisible();
  await page.getByRole('tab', { name: 'HTML', exact: true }).click();
  const html = page.getByRole('textbox', {
    name: 'Signature HTML for alex@example.com',
  });
  await expect(html).toHaveValue(signatureHtml);
  const edited = signatureHtml.replace('Alex Morgan', 'Alex Morgan · Updated');
  await html.fill(edited);
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await expect(
    page.getByText('Alex Morgan · Updated', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save signature' }).click();
  await expect(page.getByRole('status')).toHaveText('Signature saved');
  expect(
    await page.evaluate(() => window.signatureFixture.readState().patches)
  ).toEqual([{ signature: edited }]);
  await page.getByRole('button', { name: 'Signature', exact: true }).click();
  const outgoing = page.getByRole('region', {
    name: 'Signature preview',
    exact: true,
  });
  await expect(outgoing.getByText('Alex Morgan · Updated')).toBeVisible();
  await expect(outgoing.locator('table table')).toHaveCount(2);
  await page.getByRole('button', { name: 'Leave settings' }).click();
  await page.getByRole('button', { name: 'Reopen settings' }).click();
  await page.getByRole('tab', { name: 'HTML', exact: true }).click();
  await expect(html).toHaveValue(
    await page.evaluate(
      () => window.signatureFixture.readState().savedSignature ?? ''
    )
  );
  await expect(
    page.getByRole('button', { name: 'Save signature' })
  ).toBeDisabled();
});

test('rich text conversion requires consent and cancel leaves HTML untouched', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Signature editing is desktop-only');
  await page.getByRole('tab', { name: 'Rich text' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Signature preview for alex@example.com' })
      .locator('table table')
  ).toHaveCount(2);
  expect(
    await page.evaluate(() => window.signatureFixture.readState().patches)
  ).toEqual([]);
  await page.getByRole('tab', { name: 'Rich text' }).click();
  await page.getByRole('button', { name: 'Continue to rich text' }).click();
  await expect(
    page.getByRole('textbox', { name: 'Signature for alex@example.com' })
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Signature preview for alex@example.com' })
      .locator('table table')
  ).toHaveCount(2);
  await expect(
    page.getByRole('button', { name: 'Save signature' })
  ).toBeDisabled();
});

test('saved rich text can be reopened and edited without HTML conversion', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Signature editing is desktop-only');
  await page.getByRole('button', { name: 'Clear signature' }).click();
  await expect(page.getByRole('status')).toHaveText('Signature removed');
  await page.getByRole('tab', { name: 'Rich text' }).click();
  const editor = page.getByRole('textbox', {
    name: 'Signature for alex@example.com',
  });
  await editor.fill('Alex Morgan');
  await page.getByRole('button', { name: 'Save signature' }).click();
  await expect(page.getByRole('status')).toHaveText('Signature saved');
  const preview = page.getByRole('region', {
    name: 'Signature preview for alex@example.com',
  });
  await expect(preview.locator('p')).toHaveCSS('margin', '0px');
  await page.getByRole('button', { name: 'Leave settings' }).click();
  await page.getByRole('button', { name: 'Reopen settings' }).click();
  await page.getByRole('tab', { name: 'Rich text' }).click();
  await expect(editor).toBeVisible();
  await editor.fill('Alex Morgan updated');
  await page.getByRole('button', { name: 'Save signature' }).click();
  await expect(preview.getByText('Alex Morgan updated')).toBeVisible();
  expect(
    await page.evaluate(
      () => window.signatureFixture.readState().savedSignature
    )
  ).toContain('updated');
});

test('partial and logical margins still require HTML conversion', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Signature editing is desktop-only');
  for (const style of [
    'margin-top:0',
    'margin:0;margin-inline-start:24px',
    'margin:0!important',
    'margin:0;margin-left:0!important',
  ]) {
    await page.getByRole('tab', { name: 'HTML', exact: true }).click();
    const html = page.getByRole('textbox', {
      name: 'Signature HTML for alex@example.com',
    });
    const source = `<p style="${style}">Custom spacing</p>`;
    await html.fill(source);
    await page.getByRole('tab', { name: 'Rich text' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(html).toHaveValue(source);
  }
  expect(
    await page.evaluate(() => window.signatureFixture.readState().patches)
  ).toEqual([]);
});

for (const saved of [true, false]) {
  test(`clearing a rich text draft with saved signature ${saved} removes the draft`, async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Signature editing is desktop-only');
    const clear = page.getByRole('button', { name: 'Clear signature' });
    if (!saved) {
      await clear.click();
      await expect(clear).toBeDisabled();
    }
    await page.getByRole('tab', { name: 'Rich text' }).click();
    if (saved)
      await page.getByRole('button', { name: 'Continue to rich text' }).click();
    const editor = page.getByRole('textbox', {
      name: 'Signature for alex@example.com',
    });
    await editor.fill('Unsaved signature draft');
    await clear.click();
    await expect(clear).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Save signature' })
    ).toBeDisabled();
    expect(
      await page.evaluate(
        () => window.signatureFixture.readState().savedSignature
      )
    ).toBe('');
    await expect(
      page.getByRole('button', { name: 'Signature', exact: true })
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Leave settings' }).click();
    await page.getByRole('button', { name: 'Reopen settings' }).click();
    await page.getByRole('tab', { name: 'Rich text' }).click();
    await expect(editor).toBeEmpty();
    await expect(clear).toBeDisabled();
  });
}

test('a finishing clear keeps a newer draft even when its text matches', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Signature editing is desktop-only');
  await page.getByRole('button', { name: 'Clear signature' }).click();
  await expect(page.getByRole('status')).toHaveText('Signature removed');
  await page.getByRole('tab', { name: 'Rich text' }).click();
  const editor = page.getByRole('textbox', {
    name: 'Signature for alex@example.com',
  });
  await editor.fill('First draft');
  await page.getByRole('button', { name: 'Save signature' }).click();
  await expect(page.getByRole('status')).toHaveText('Signature saved');
  await page.getByRole('tab', { name: 'Rich text' }).click();
  await editor.fill('Pending draft');
  await page.evaluate(() => window.signatureFixture.holdAccountRefresh());
  await page.getByRole('button', { name: 'Clear signature' }).click();
  // The cache update remounts settings before the mutation's refresh completes.
  await expect(
    page.getByRole('tab', { name: 'Preview', exact: true })
  ).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Rich text' }).click();
  await editor.fill('Newer draft');
  await editor.fill('Pending draft');
  await page.evaluate(() => window.signatureFixture.releaseAccountRefresh());
  await expect(page.getByRole('status')).toHaveText('Signature removed');
  await expect(editor).toHaveText('Pending draft');
  await expect(
    page.getByRole('button', { name: 'Save signature' })
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Save signature' }).click();
  await expect(page.getByRole('status')).toHaveText('Signature saved');
  await expect(
    page
      .getByRole('region', { name: 'Signature preview for alex@example.com' })
      .getByText('Pending draft')
  ).toBeVisible();
});

test('pasting a custom signature bypasses Quill conversion', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Signature editing is desktop-only');
  await page.getByRole('button', { name: 'Clear signature' }).click();
  await expect(page.getByRole('status')).toHaveText('Signature removed');
  await page.getByRole('tab', { name: 'Rich text' }).click();
  const editor = page.getByRole('textbox', {
    name: 'Signature for alex@example.com',
  });
  await editor.click();
  await editor.evaluate((element, html) => {
    const data = new DataTransfer();
    data.setData('text/html', html);
    data.setData('text/plain', 'Alex Morgan');
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      })
    );
  }, signatureHtml);
  const preview = page.getByRole('region', {
    name: 'Signature preview for alex@example.com',
  });
  await expect(preview.locator('table table')).toHaveCount(2);
  await page.getByRole('button', { name: 'Save signature' }).click();
  await expect(page.getByRole('status')).toHaveText('Signature saved');
  expect(
    await page.evaluate(() =>
      window.signatureFixture.readState().patches.at(-1)
    )
  ).toEqual({ signature: signatureHtml });
});

test('text styling that Quill drops is kept as HTML when pasted', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Signature editing is desktop-only');
  await page.getByRole('button', { name: 'Clear signature' }).click();
  await expect(page.getByRole('status')).toHaveText('Signature removed');
  await page.getByRole('tab', { name: 'Rich text' }).click();
  const editor = page.getByRole('textbox', {
    name: 'Signature for alex@example.com',
  });
  await editor.click();
  const html =
    '<p style="text-align:center;font-weight:500">Centered signature</p>';
  await editor.evaluate((element, html) => {
    const data = new DataTransfer();
    data.setData('text/html', html);
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      })
    );
  }, html);
  const signature = page
    .getByRole('region', { name: 'Signature preview for alex@example.com' })
    .getByText('Centered signature');
  await expect(signature).toHaveCSS('text-align', 'center');
  await expect(signature).toHaveCSS('font-weight', '500');
  await page.getByRole('tab', { name: 'Rich text' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Save signature' }).click();
  await expect(page.getByRole('status')).toHaveText('Signature saved');
  expect(
    await page.evaluate(() =>
      window.signatureFixture.readState().patches.at(-1)
    )
  ).toEqual({ signature: html });
});

test('draft previews strip active markup and isolate signature styles', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Signature editing is desktop-only');
  await page.getByRole('tab', { name: 'HTML', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Signature HTML for alex@example.com' })
    .fill(
      '<style>body {display:none} :host {display:none}</style><p onclick="window.alert(1)">Safe signature</p><img src="x" onerror="window.alert(1)"><script>window.alert(1)</script><a href="javascript:alert(1)">Link</a><iframe srcdoc="bad"></iframe>'
    );
  const dialogs: string[] = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  const preview = page.getByRole('region', {
    name: 'Signature preview for alex@example.com',
  });
  await expect(preview.getByText('Safe signature')).toBeVisible();
  await expect(
    preview.locator('script,iframe,[onclick],[onerror],a[href^="javascript:"]')
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Save signature' })
  ).toBeVisible();
  expect(dialogs).toEqual([]);
});
