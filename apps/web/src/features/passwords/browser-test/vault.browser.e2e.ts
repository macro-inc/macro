import { expect, type Locator, type Page, test } from '@playwright/test';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 1024, height: 768 },
] as const;

type Viewport = (typeof VIEWPORTS)[number];

/** New → kind, from the desktop New menu or the phone's floating New. */
async function startNew(page: Page, viewport: Viewport, kind: string) {
  if (viewport.name === 'desktop') {
    await page
      .getByRole('button', { name: /^New item in/ })
      .last()
      .click();
    await page.getByRole('menuitem', { name: kind, exact: true }).click();
    return;
  }
  await page.getByRole('button', { name: 'New', exact: true }).last().tap();
  await page.getByRole('button', { name: kind, exact: true }).last().tap();
  // The touch menu runs its choice after it closes; wait for the new pane.
  await expect(
    page.getByRole('heading', { name: 'Untitled', exact: true })
  ).toBeVisible();
}

async function press(page: Page, viewport: Viewport, name: string | RegExp) {
  const button = page
    .getByRole('button', { name, exact: typeof name === 'string' })
    .first();
  if (viewport.name === 'desktop') await button.click();
  else await button.tap();
}

/** Phones replace the list with the detail; wider layouts keep both. */
async function backToList(page: Page, viewport: Viewport) {
  const back = page.getByRole('button', { name: 'Back', exact: true });
  if (await back.isVisible()) await press(page, viewport, 'Back');
}

for (const viewport of VIEWPORTS) {
  test.describe(viewport.name, () => {
    test.use({
      hasTouch: viewport.name !== 'desktop',
      isMobile: viewport.name !== 'desktop',
    });
    // The first load compiles the fixture under a cold dev server.
    test.setTimeout(360_000);

    test(`${viewport.name}: a new item keeps its input through blur, hiding, lock and selecting away`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('/src/features/passwords/browser-test/vault.html', {
        timeout: 240_000,
      });

      await startNew(page, viewport, 'Login');
      await expect(page.getByLabel('Type', { exact: true })).toHaveCount(0);
      await page.getByLabel('Name', { exact: true }).fill('Workspace login');
      await page.getByLabel('Username', { exact: true }).fill('fixture-user');
      await page
        .getByLabel('Password', { exact: true })
        .fill('initial-password');

      await page.evaluate(() => {
        window.dispatchEvent(new Event('blur'));
        Object.defineProperty(document, 'hidden', {
          configurable: true,
          get: () => true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'hidden', {
          configurable: true,
          get: () => false,
        });
      });
      await backToList(page, viewport);
      await startNew(page, viewport, 'Secure note');
      await page.getByLabel('Name', { exact: true }).fill('Second draft');
      await backToList(page, viewport);
      if (viewport.name === 'desktop')
        await press(page, viewport, 'Lock Passwords');
      await press(page, viewport, /Workspace login.*Draft/);
      await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
        'Workspace login'
      );
      await expect(page.getByLabel('Username', { exact: true })).toHaveValue(
        'fixture-user'
      );
      await expect(page.getByLabel('Password', { exact: true })).toHaveValue(
        'initial-password'
      );

      await press(page, viewport, 'Save');
      await expect(
        page.getByRole('heading', { name: 'Workspace login' })
      ).toBeVisible();
      await expect(
        page.getByText('fixture-user', { exact: true })
      ).toBeVisible();
      await expect(
        page.getByText('initial-password', { exact: true })
      ).toHaveCount(0);
      await press(page, viewport, 'Reveal Password');
      await expect(
        page.getByText('initial-password', { exact: true })
      ).toBeVisible();
      await press(page, viewport, 'Copy Password');
      await expect(page.locator('body')).toHaveAttribute(
        'data-copied',
        'initial-password'
      );
      await press(page, viewport, 'Edit');
      await press(page, viewport, 'Generate password');
      await page
        .getByRole('menuitem', { name: 'Use password', exact: true })
        .click();
      await expect(
        page.getByLabel('Password', { exact: true })
      ).not.toHaveValue('initial-password');
      await press(page, viewport, 'Discard');
      await expect(
        page.getByRole('heading', { name: 'Workspace login' })
      ).toBeVisible();

      await backToList(page, viewport);
      await expect(
        page.getByRole('button', { name: /Second draft.*Draft/ })
      ).toBeVisible();
      await page.screenshot({
        path: `/home/wolf/tmp/passwords-shots/drafts-${viewport.name}.png`,
      });
      expect(errors).toEqual([]);
    });

    test(`${viewport.name}: verification code items need a key and show a live code`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('/src/features/passwords/browser-test/vault.html', {
        timeout: 240_000,
      });
      await startNew(page, viewport, 'Verification code');
      await page.getByLabel('Name', { exact: true }).fill('Domain registrar');
      await page.getByLabel('Account', { exact: true }).fill('ops@example.com');
      await press(page, viewport, 'Save');
      await expect(page.getByText('Enter the secret key.')).toBeVisible();
      await page
        .getByLabel('Verification code', { exact: true })
        .fill('JBSWY3DPEHPK3PXP');
      await press(page, viewport, 'Save');
      await expect(
        page.getByRole('heading', { name: 'Domain registrar' })
      ).toBeVisible();
      await press(page, viewport, 'Show verification code');
      await expect(page.getByText('123 456', { exact: true })).toBeVisible();
      await page.screenshot({
        path: `/home/wolf/tmp/passwords-shots/totp-${viewport.name}.png`,
      });
      expect(errors).toEqual([]);
    });
  });
}

/** Moves a real pointer onto `target` in steps and waits until it is hovered. */
async function pointTo(page: Page, target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error('Pointer target is not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 25,
  });
  const handle = await target.elementHandle();
  await page.waitForFunction((element) => element?.matches(':hover'), handle);
}

test.describe('desktop pointer', () => {
  test('New > Card with a real pointer right after a save opens the Card draft', async ({
    page,
  }) => {
    const viewport = VIEWPORTS[0];
    await page.setViewportSize(viewport);
    test.setTimeout(360_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/src/features/passwords/browser-test/vault.html', {
      timeout: 240_000,
    });
    await startNew(page, viewport, 'Login');
    await page.getByLabel('Name', { exact: true }).fill('Saved before Card');
    await press(page, viewport, 'Save');
    await expect(
      page.getByRole('button', { name: 'Edit', exact: true })
    ).toBeVisible();

    const trigger = page.getByRole('button', { name: /^New item in/ }).first();
    // An open menu hides the rest of the page from role queries; keep the element.
    const triggerElement = await trigger.elementHandle();
    await pointTo(page, trigger);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForFunction(
      (element) => element?.getAttribute('aria-expanded') === 'true',
      triggerElement
    );
    const card = page.getByRole('menuitem', { name: 'Card', exact: true });
    await expect(card).toBeVisible();
    await pointTo(page, card);
    await expect(card).toHaveAttribute('data-highlighted', '');
    await page.mouse.down();
    await page.mouse.up();

    await expect(
      page.getByRole('heading', { name: 'Untitled', exact: true })
    ).toBeVisible();
    await expect(page.getByLabel('Cardholder', { exact: true })).toBeVisible();
    await press(page, viewport, /Saved before Card/);
    await expect(
      page.getByRole('heading', { name: 'Saved before Card' })
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('desktop view-only', () => {
  test('a view-only item reveals but offers no edit, share, delete or code changes', async ({
    page,
  }) => {
    const viewport = VIEWPORTS[0];
    await page.setViewportSize(viewport);
    test.setTimeout(360_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/src/features/passwords/browser-test/vault.html', {
      timeout: 240_000,
    });
    await press(page, viewport, /View-only login/);
    await expect(
      page.getByRole('heading', { name: 'View-only login' })
    ).toBeVisible();
    await press(page, viewport, 'Reveal Password');
    await expect(
      page.getByText('view-only-secret', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Edit', exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Share', exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Add verification code' })
    ).toHaveCount(0);
    await press(page, viewport, 'More item actions');
    await expect(
      page.getByRole('menuitem', { name: 'Delete item' })
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  });
});

test.describe('desktop keyboard', () => {
  test('typing key by key keeps focus in template and custom fields', async ({
    page,
  }) => {
    const viewport = VIEWPORTS[0];
    await page.setViewportSize(viewport);
    test.setTimeout(360_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/src/features/passwords/browser-test/vault.html', {
      timeout: 240_000,
    });
    const typeInto = async (field: Locator, text: string) => {
      await field.click();
      await field.pressSequentially(text);
      await expect(field).toHaveValue(text);
      await expect(field).toBeFocused();
    };
    const byLabel = (label: string) =>
      page.locator(`input[aria-label="${label}"]`);

    await startNew(page, viewport, 'Login');
    await typeInto(page.getByLabel('Name', { exact: true }), 'Deploy login');
    await typeInto(page.getByLabel('Username', { exact: true }), 'deploy-bot');
    await typeInto(
      page.getByLabel('Password', { exact: true }),
      'not-a-real-secret'
    );
    await press(page, viewport, 'Discard');

    await startNew(page, viewport, 'Card');
    await typeInto(page.getByLabel('Name', { exact: true }), 'Team card');
    await typeInto(byLabel('Expires'), '12/2028');
    await typeInto(byLabel('Security code'), '4321');
    await expect(page.getByText('Unsaved items')).toHaveCount(0);

    await press(page, viewport, 'Add field');
    await typeInto(page.getByLabel('Field label').last(), 'Recovery email');
    await typeInto(byLabel('Recovery email'), 'backup@example.test');

    const expiresLabel = page.getByLabel('Field label').first();
    await expiresLabel.click();
    await page.keyboard.press('ControlOrMeta+a');
    await expiresLabel.pressSequentially('Valid thru');
    await expect(expiresLabel).toHaveValue('Valid thru');
    await expect(expiresLabel).toBeFocused();
    await expect(byLabel('Valid thru')).toHaveValue('12/2028');
    await expect(byLabel('Valid thru')).toHaveAttribute('type', 'password');

    await page.getByRole('button', { name: 'Remove field' }).first().click();
    await expect(page.getByLabel('Field label')).toHaveCount(2);
    await expect(page.getByLabel('Field label').first()).toHaveValue(
      'Security code'
    );
    await expect(byLabel('Security code')).toHaveValue('4321');
    await expect(byLabel('Recovery email')).toHaveValue('backup@example.test');
    await expect(byLabel('Valid thru')).toHaveCount(0);
    await press(page, viewport, 'Discard');

    await startNew(page, viewport, 'Identity');
    await typeInto(byLabel('Email'), 'ops@example.test');
    await typeInto(byLabel('Phone'), '+1 555 0100');
    await typeInto(byLabel('Address'), 'Example location');
    await press(page, viewport, 'Discard');
    expect(errors).toEqual([]);
  });
});

/** True when the element's centre is not painted over by another element. */
function uncovered(locator: Locator) {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2
    );
    return !!hit && (hit === element || element.contains(hit));
  });
}

test.describe('phone device', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  test('a full-screen draft or item hides the list pills and New; Back brings them back', async ({
    page,
  }) => {
    test.setTimeout(360_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/src/features/passwords/browser-test/vault.html', {
      timeout: 240_000,
    });
    const pills = page
      .locator('[data-view-shell-header]')
      .filter({ visible: true });
    const floatingNew = page
      .getByRole('button', { name: 'New', exact: true })
      .filter({ visible: true });
    await expect(pills).toHaveCount(1);
    await expect(floatingNew).toHaveCount(1);

    await startNew(page, VIEWPORTS[1], 'Login');
    await expect(pills).toHaveCount(0);
    await expect(floatingNew).toHaveCount(0);
    const name = page.getByLabel('Name', { exact: true });
    expect(await uncovered(page.locator('label', { hasText: /^Name$/ }))).toBe(
      true
    );
    await name.fill('Phone login');
    await page.getByLabel('Username', { exact: true }).fill('phone-user');
    await press(page, VIEWPORTS[1], 'Save');
    await expect(
      page.getByRole('button', { name: 'Edit', exact: true })
    ).toBeVisible();
    await expect(pills).toHaveCount(0);
    await expect(floatingNew).toHaveCount(0);
    expect(await uncovered(page.getByText('phone-user', { exact: true }))).toBe(
      true
    );

    await press(page, VIEWPORTS[1], 'Back');
    await expect(pills).toHaveCount(1);
    await expect(floatingNew).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: /Phone login/ })
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('tablet device', () => {
  test.use({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
    isMobile: true,
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  test('an item beside the list keeps the list pills and New', async ({
    page,
  }) => {
    test.setTimeout(360_000);
    await page.goto('/src/features/passwords/browser-test/vault.html', {
      timeout: 240_000,
    });
    await press(page, VIEWPORTS[2], /View-only login/);
    await expect(
      page.getByRole('heading', { name: 'View-only login' })
    ).toBeVisible();
    await expect(
      page.locator('[data-view-shell-header]').filter({ visible: true })
    ).toHaveCount(1);
    await expect(
      page
        .getByRole('button', { name: 'New', exact: true })
        .filter({ visible: true })
    ).toHaveCount(1);
  });
});

test.describe('desktop agent access', () => {
  test('agent access: a notification opens the item, approve edit, revoke, stale decisions refetch', async ({
    page,
  }) => {
    const viewport = VIEWPORTS[0];
    await page.setViewportSize(viewport);
    test.setTimeout(360_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const fixture = '/src/features/passwords/browser-test/vault.html';
    const item = '019a0000-0000-7000-8000-0000000000bb';
    const section = page.getByRole('region', { name: 'Agent access' });

    // A notification for another team opens the vault without a selection.
    await page.goto(`${fixture}?focus=${item}&focusTeam=other-team`, {
      timeout: 240_000,
    });
    await expect(
      page.getByRole('button', { name: /Agent requested login/ })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Agent requested login' })
    ).toHaveCount(0);

    // The current team's notification opens the item with its request.
    await page.goto(`${fixture}?focus=${item}`, { timeout: 240_000 });
    await expect(
      page.getByRole('heading', { name: 'Agent requested login' })
    ).toBeVisible();
    await expect(section.getByText(/asked to edit this item/)).toBeVisible();
    await section.getByRole('button', { name: 'Allow edit' }).click();
    await expect(section.getByText(/can edit this item/)).toBeVisible();
    await section.getByRole('button', { name: /^Revoke access for/ }).click();
    await page.getByRole('menuitem', { name: 'Remove access' }).click();
    await expect(section).toHaveCount(0);

    // Someone else approved view first: the decision is stale and the pane
    // shows what they decided.
    await page.goto(`${fixture}?focus=${item}&agentStale=1`, {
      timeout: 240_000,
    });
    await expect(section.getByText(/asked to edit this item/)).toBeVisible();
    await section.getByRole('button', { name: 'Allow edit' }).click();
    await expect(
      section.getByText('This request changed. Showing the latest.')
    ).toBeVisible();
    await expect(section.getByText(/can view this item/)).toBeVisible();

    // An item the viewer cannot manage has no agent controls.
    await press(page, viewport, /View-only login/);
    await expect(
      page.getByRole('heading', { name: 'View-only login' })
    ).toBeVisible();
    await expect(section).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('desktop creation', () => {
  test('New creates items only, and a failed folder create offers Retry under the same parent', async ({
    page,
  }) => {
    const viewport = VIEWPORTS[0];
    await page.setViewportSize(viewport);
    test.setTimeout(360_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/src/features/passwords/browser-test/vault.html', {
      timeout: 240_000,
    });
    const tree = page.getByRole('navigation', { name: 'Folders' });

    // Both New menus list item kinds and no folder entry.
    for (const trigger of await page
      .getByRole('button', { name: /^New item in/ })
      .filter({ visible: true })
      .all()) {
      await trigger.click();
      await expect(
        page.getByRole('menuitem', { name: 'Login', exact: true })
      ).toBeVisible();
      await expect(
        page.getByRole('menuitem', { name: 'Folder', exact: true })
      ).toHaveCount(0);
      await page.keyboard.press('Escape');
    }

    // Folders come from the sidebar's "+"; the first create of this name fails.
    await press(page, viewport, 'New folder');
    await page.getByLabel('Folder name', { exact: true }).fill('Ops');
    await page.getByLabel('Folder name', { exact: true }).press('Enter');
    await tree.getByRole('button', { name: 'Ops', exact: true }).click();
    await page
      .getByRole('button', { name: 'Folder actions for Ops', exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: 'New subfolder', exact: true })
      .click();
    const field = page.getByLabel('Folder name', { exact: true });
    await field.fill('Unreachable folder');
    await field.press('Enter');
    const failure = page.getByText('Could not create the folder');
    await expect(failure).toBeVisible();
    await expect(
      tree.getByRole('button', { name: 'Unreachable folder', exact: true })
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Retry', exact: true })
      .evaluate((button) => {
        if (button instanceof HTMLButtonElement) {
          button.click();
          button.click();
        }
      });
    const created = tree.getByRole('button', {
      name: 'Unreachable folder',
      exact: true,
    });
    await expect(created).toBeVisible();
    await expect(created).toHaveCount(1);
    await expect(failure).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Retry', exact: true })
    ).toHaveCount(0);
    await expect(page.locator('body')).toHaveAttribute(
      'data-folder-create-attempts',
      '2'
    );
    // Retried under Ops, not at the top level.
    await created.click();
    await expect(
      page.getByRole('button', {
        name: /^New item in Ops \/ Unreachable folder$/,
      })
    ).toHaveCount(2);
    expect(errors).toEqual([]);
  });
});

test.describe('desktop folders', () => {
  test('creates, nests, renames and deletes folders; items move to All items', async ({
    page,
  }) => {
    const viewport = VIEWPORTS[0];
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/src/features/passwords/browser-test/vault.html', {
      timeout: 240_000,
    });

    await press(page, viewport, 'New folder');
    await page.getByLabel('Folder name', { exact: true }).fill('Engineering');
    await page.getByLabel('Folder name', { exact: true }).press('Enter');
    const tree = page.getByRole('navigation', { name: 'Folders' });
    await tree
      .getByRole('button', { name: 'Engineering', exact: true })
      .click();
    await press(page, viewport, 'Folder actions for Engineering');
    await page
      .getByRole('menuitem', { name: 'New subfolder', exact: true })
      .click();
    await expect(page.getByLabel('Folder name', { exact: true })).toBeFocused();
    await page.getByLabel('Folder name', { exact: true }).fill('Production');
    await page.getByLabel('Folder name', { exact: true }).press('Enter');

    await startNew(page, viewport, 'Login');
    await page.getByLabel('Name', { exact: true }).fill('Filed login');
    await press(page, viewport, 'Save');
    await expect(page.getByText('Engineering / Login')).toBeVisible();

    // The header "…" menu hands focus to the inline field it opens.
    await tree.getByRole('button', { name: 'Production', exact: true }).click();
    await press(page, viewport, 'Folder actions for Production');
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    await expect(page.getByLabel('Rename', { exact: true })).toBeFocused();
    await page.getByLabel('Rename', { exact: true }).fill('Prod');
    await page.getByLabel('Rename', { exact: true }).press('Enter');
    await expect(
      tree.getByRole('button', { name: 'Prod', exact: true })
    ).toBeVisible();

    await tree.getByRole('button', { name: 'Engineering', exact: true }).click({
      button: 'right',
    });
    await page
      .getByRole('menuitem', { name: 'Delete folder', exact: true })
      .click();
    await expect(page.getByText('1 item moves to All items.')).toBeVisible();
    await expect(page.getByText('1 subfolder is deleted too.')).toBeVisible();
    await page.screenshot({
      path: '/home/wolf/tmp/passwords-shots/folder-delete-desktop.png',
    });
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete folder' })
      .click();
    await expect(
      tree.getByRole('button', { name: 'Engineering', exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'All items' })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Filed login/ })
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
});

for (const viewport of VIEWPORTS.slice(1)) {
  test.describe(`${viewport.name} folder creation`, () => {
    test.use({ hasTouch: true, isMobile: true });
    test('item New has no Folder; the Folders navigation keeps its create action', async ({
      page,
    }) => {
      test.setTimeout(360_000);
      await page.setViewportSize(viewport);
      await page.goto('/src/features/passwords/browser-test/vault.html', {
        timeout: 240_000,
      });
      await page.getByRole('button', { name: 'New', exact: true }).last().tap();
      await expect(
        page.getByRole('button', { name: 'Folder', exact: true })
      ).toHaveCount(0);
      await page
        .getByRole('button', { name: 'Login', exact: true })
        .last()
        .tap();
      await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
      await backToList(page, viewport);
      const main = page.locator('[data-view-shell-main]');
      const folders = main.getByRole('button', {
        name: 'Folders',
        exact: true,
      });
      await folders.scrollIntoViewIfNeeded();
      await folders.tap();
      await main.getByRole('button', { name: 'New folder', exact: true }).tap();
      await expect(page.getByLabel('Folder name', { exact: true })).toHaveCount(
        1
      );
      await main
        .getByLabel('Folder name', { exact: true })
        .fill('Touch folder');
      await page.getByLabel('Folder name', { exact: true }).press('Enter');
      await expect(
        main
          .getByRole('navigation', { name: 'Folders' })
          .getByRole('button', { name: 'Touch folder', exact: true })
      ).toBeVisible();
    });
  });
}
