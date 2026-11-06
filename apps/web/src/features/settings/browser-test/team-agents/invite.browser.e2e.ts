import { expect, test } from '@playwright/test';

test('reviews the price and confirms once with reachable actions', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Invite agent', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Assistant');
  await page.getByLabel('Role / job description').fill('Maintain projects');
  await page.getByLabel('Personality').fill('Concise and helpful');
  const review = page.getByRole('button', { name: 'Review price' });
  await expect(review).toBeInViewport();
  await expect
    .poll(async () => {
      const bounds = await review.boundingBox();
      return bounds ? bounds.y + bounds.height : Number.POSITIVE_INFINITY;
    })
    .toBeLessThanOrEqual(page.viewportSize()!.height);
  await review.click();
  await expect(page.getByText('Total per month')).toBeVisible();
  await expect(page.getByText('$50.00')).toBeVisible();
  await expect(page.getByText('Purchases: 0')).toBeVisible();
  const confirm = page.getByRole('button', { name: 'Confirm and invite' });
  await expect(confirm).toBeInViewport();
  await confirm.click();
  await expect(page.getByText('Purchases: 1')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Invite agent', exact: true })
  ).toBeFocused();
  await page.getByRole('button', { name: 'Invite agent', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('');
});

test('recovers a quote error without purchasing', async ({ page }) => {
  await page.goto('/?quote-error');
  await page.getByRole('button', { name: 'Invite agent', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Assistant');
  await page.getByLabel('Role / job description').fill('Maintain projects');
  await page.getByLabel('Personality').fill('Concise');
  await page.getByRole('button', { name: 'Review price' }).click();
  await expect(
    page.getByRole('button', { name: 'Confirm and invite' })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(
    page.getByRole('button', { name: 'Confirm and invite' })
  ).toBeEnabled();
  await expect(page.getByText('Purchases: 0')).toBeVisible();
});

test('keeps phone actions above the keyboard while long fields scroll', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone');
  await page.goto('/');
  await page.getByRole('button', { name: 'Invite agent', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Assistant');
  await page
    .getByLabel('Role / job description')
    .fill('A long responsibility. '.repeat(80));
  await page.getByLabel('Personality').fill('Helpful and concise. '.repeat(80));
  await page.evaluate(() =>
    document.documentElement.style.setProperty(
      '--virtual-keyboard-height',
      '280px'
    )
  );
  const review = page.getByRole('button', { name: 'Review price' });
  await expect(review).toBeInViewport();
  await expect
    .poll(async () => {
      const bounds = await review.boundingBox();
      return bounds ? bounds.y + bounds.height : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(page.viewportSize()!.height - 280);
  await review.click();
  await expect(
    page.getByRole('button', { name: 'Confirm and invite' })
  ).toBeInViewport();
});

test('blocks pending payment actions and permits unbilled removal and paid provisioning retry', async ({
  page,
}) => {
  await page.goto('/?payments');
  await expect(
    page.getByRole('progressbar', { name: 'Agent setup' })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Retry', exact: true })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(
    page.getByRole('menuitem', { name: 'Remove agent' })
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Set payment failure' }).click();
  await expect(
    page.getByText("Couldn't add Assistant: payment didn't go through", {
      exact: true,
    })
  ).toBeVisible();

  await expect(
    page.getByRole('button', { name: 'Retry', exact: true })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Remove agent' }).click();
  await expect(page.getByText('Removals: 1')).toBeVisible();
  await page.getByRole('button', { name: 'Set paid failure' }).click();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.getByRole('note')).toHaveText('Brain unavailable');
  await page.getByRole('menuitem', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('Retry requests: 1')).toBeVisible();
  await expect(
    page.getByRole('progressbar', { name: 'Agent setup' })
  ).toHaveAttribute('aria-valuetext', 'Booting — step 2 of 3');
  await expect(
    page.getByRole('button', { name: 'Retry', exact: true })
  ).toHaveCount(0);
});

test('shows catalog specs and billing action without an active plan', async ({
  page,
}) => {
  await page.goto('/?no-subscription');
  await page.getByRole('button', { name: 'Invite agent', exact: true }).click();
  await expect(page.getByText('4 vCPUs', { exact: true })).toBeVisible();
  await expect(page.getByText(/^(?:·\s*)?16 GB RAM$/)).toHaveCount(1);
  await expect(page.getByText('Specifications unavailable')).toHaveCount(0);
  await expect(page.getByText(/Your team needs an active plan/)).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Go to billing' })
  ).toHaveAttribute('href', '/app/settings/billing');
  await page.getByLabel('Name', { exact: true }).fill('Assistant');
  await page.getByLabel('Role / job description').fill('Maintain projects');
  await page.getByLabel('Personality').fill('Concise');
  await expect(
    page.getByRole('button', { name: 'Review price' })
  ).toBeDisabled();
  await expect(page.getByText('Purchases: 0')).toBeVisible();
});

test('typing keeps fields and the invitation surface mounted with bounded DOM work', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Invite agent', exact: true }).click();
  const fields = page.getByRole('textbox');
  const originalFields = await fields.elementHandles();
  const work = await page.evaluateHandle(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) throw new Error('Invitation surface missing');
    let addedNodes = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records) addedNodes += record.addedNodes.length;
    });
    observer.observe(dialog, { subtree: true, childList: true });
    return {
      finish: () => {
        observer.disconnect();
        return addedNodes;
      },
    };
  });
  for (const [index, text] of [
    'Assistant',
    'Maintain projects',
    'Concise and helpful',
  ].entries()) {
    await fields.nth(index).pressSequentially(text);
    expect(
      await originalFields[index].evaluate((field) => field.isConnected)
    ).toBe(true);
    await expect(fields.nth(index)).toHaveValue(text);
  }
  const addedNodes = await work.evaluate((measurement) => measurement.finish());
  await work.dispose();
  expect(addedNodes).toBeLessThan(20);
});

test('reviews an included invitation and explains a pre-purchase repository failure', async ({
  page,
}) => {
  await page.goto('/?included&repository-failure&no-subscription');
  await page.getByRole('button', { name: 'Invite agent', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Assistant');
  await page.getByLabel('Role / job description').fill('Maintain projects');
  await page.getByLabel('Personality').fill('Concise');
  await page.getByRole('button', { name: 'Review price' }).click();
  await expect(
    page.getByText('Included for Macro', { exact: true })
  ).toBeVisible();
  await expect(page.getByText('Total per month')).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirm and invite' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'The workspace repository could not be created. Nothing was charged.'
  );
  await expect(
    page.getByRole('button', { name: 'Confirm and invite' })
  ).toBeDisabled();
  await expect(page.getByText('Purchases: 0')).toBeVisible();
});

test('requires a fresh review before billing when included eligibility changes', async ({
  page,
}) => {
  await page.goto('/?included&quote-changed');
  await page.getByRole('button', { name: 'Invite agent', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Assistant');
  await page.getByLabel('Role / job description').fill('Maintain projects');
  await page.getByLabel('Personality').fill('Concise');
  await page.getByRole('button', { name: 'Review price' }).click();
  await expect(
    page.getByText('Included for Macro', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Confirm and invite' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'The quote changed. Review the price again. Nothing was charged.'
  );
  await expect(
    page.getByText('Included for Macro', { exact: true })
  ).toBeVisible();
  await expect(page.getByText('Purchases: 0')).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
    'Assistant'
  );
  await page.getByRole('button', { name: 'Review price' }).click();
  await expect(page.getByText('$50.00', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Included for Macro', { exact: true })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirm and invite' }).click();
  await expect(page.getByText('Purchases: 1')).toBeVisible();
});

test('generates portraits only on explicit request and saves uploads', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Invite agent', exact: true }).click();
  await page
    .getByLabel('Name', { exact: true })
    .pressSequentially('Assistant', { delay: 80 });
  await expect(
    page.getByText('Portrait generations: 0', { exact: true })
  ).toBeVisible();
  await expect(page.getByRole('img', { name: 'Agent portrait' })).toHaveCount(
    0
  );
  await page
    .getByRole('button', { name: 'Generate portrait', exact: true })
    .click();
  await expect(page.getByRole('img', { name: 'Agent portrait' })).toBeVisible();
  await expect(
    page.getByText('Portrait generations: 1', { exact: true })
  ).toBeVisible();
  await page.getByLabel('Role / job description').fill('Maintain projects');
  await page.getByLabel('Personality').fill('Concise');
  await page
    .getByRole('button', { name: 'Generate another', exact: true })
    .click();
  await expect(
    page.getByText('Portrait generations: 2', { exact: true })
  ).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Upload photo', exact: true }).click();
  await (await chooser).setFiles({
    name: 'portrait.png',
    mimeType: 'image/png',
    buffer: Buffer.from('fixture photo'),
  });
  await expect(
    page.getByText('Photo uploads: 1', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Review price' }).click();
  await page.getByRole('button', { name: 'Confirm and invite' }).click();
  await expect(
    page.getByText(
      'Saved avatar: https://fixture.invalid/uploaded-avatar.png',
      { exact: true }
    )
  ).toBeVisible();
});

for (const width of [390, 320]) {
  test(`size specifications preserve units at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Invite agent', exact: true })
      .click();
    for (const spec of [
      '4 vCPUs',
      '8 GB RAM',
      '100 GB disk',
      '8 vCPUs',
      '16 GB RAM',
      '200 GB disk',
      '16 vCPUs',
      '32 GB RAM',
      '400 GB disk',
    ]) {
      const item = page.getByText(new RegExp(`^(?:·\\s*)?${spec}$`));
      await item.scrollIntoViewIfNeeded();
      expect(
        await item.evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return new Set(
            Array.from(range.getClientRects(), (rect) => Math.round(rect.y))
          ).size;
        })
      ).toBe(1);
    }
    await page.getByText('XL', { exact: true }).click();
    await expect(page.getByRole('radio', { name: /XL/ })).toBeChecked();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
  });
}

test('portrait failure offers an explicit retry without discarding profile fields', async ({
  page,
}) => {
  await page.goto('/?portrait-error');
  await page.getByRole('button', { name: 'Invite agent', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Assistant');
  await page
    .getByRole('button', { name: 'Generate portrait', exact: true })
    .click();
  await page.getByLabel('Role / job description').fill('Maintain projects');
  await page.getByLabel('Personality').fill('Concise');
  await expect(page.getByRole('alert')).toContainText(
    "Couldn't prepare the photo"
  );
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Agent portrait' })).toBeVisible();
  await expect(
    page.getByText('Portrait generations: 2', { exact: true })
  ).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
    'Assistant'
  );
  await page.getByRole('button', { name: 'Review price' }).click();
  await page.getByRole('button', { name: 'Confirm and invite' }).click();
  await expect(page.getByText('Purchases: 1', { exact: true })).toBeVisible();
});

test('keeps payment diagnostics out of a non-admin setup row', async ({
  page,
}) => {
  await page.goto('/?payments&non-admin');
  await expect(page.getByText('Setting up…', { exact: true })).toBeVisible();
  await expect(page.getByText('Paying', { exact: true })).toHaveCount(0);
  await expect(
    page.getByText('Confirming payment', { exact: true })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Set payment failure' }).click();
  await expect(page.getByText('Setting up…', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Billing', exact: true })
  ).toHaveCount(0);
  await expect(page.getByText(/Couldn't add Assistant/)).toHaveCount(0);
});
