import { expect, test } from '@playwright/test';

const SHOTS = process.env.PERMISSIONS_SCREENSHOT_DIR;
/** `light` renders the fixture in Macro Light, for screenshots. */
const THEME = process.env.PERMISSIONS_THEME;

function fixture(query = '') {
  const params = new URLSearchParams(query);
  if (THEME) params.set('theme', THEME);
  const search = params.toString();
  return `/permissions.html${search ? `?${search}` : ''}`;
}

async function shot(
  page: import('@playwright/test').Page,
  name: string,
  isMobile: boolean
) {
  const path = SHOTS
    ? `${SHOTS}/${name}-${isMobile ? 'mobile' : 'desktop'}-${THEME ?? 'dark'}.png`
    : test.info().outputPath(`${name}.png`);
  // Let carets and menus finish moving before the picture.
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((animation) => animation.finished))
  );
  // The transcript (or the page) scrolls inside the window, as in the app:
  // grow the window to all of it for the picture, then put it back.
  const size = page.viewportSize();
  const height = await page.evaluate(() => {
    const transcript = document.querySelector('[aria-label="Agent session"]');
    const main = document.querySelector('main');
    if (!main) return 0;
    // The permissions page scrolls the whole main.
    if (!transcript) return main.scrollHeight;
    return (
      main.scrollHeight - transcript.clientHeight + transcript.scrollHeight
    );
  });
  if (size && height > size.height) {
    await page.setViewportSize({ width: size.width, height });
  }
  await page.screenshot({ path });
  if (size) await page.setViewportSize(size);
}

// JS tools programs, whose saved records the cards load.
const LANGUAGES = [
  { language: 'js_tools', program: 'tools.email.send_message' },
] as const;

for (const { language, program } of LANGUAGES) {
  test.describe(`${language} programs`, () => {
    test('a blocked program says what was refused and links to the permissions', async ({
      page,
      isMobile,
    }) => {
      await page.goto(fixture(`language=${language}`));
      const blocked = page.getByRole('region', {
        name: 'Blocked by permissions',
      });
      await expect(blocked).toBeVisible();
      await expect(blocked).toContainText(
        'Nothing ran. This program could delete email, and Scout is never allowed to.'
      );
      await expect(blocked).toContainText('Delete email filter');
      // A blocked program stands alone; a declined one is a quiet row in its
      // tool group, which doesn't count it as failed.
      await page.getByRole('button', { name: 'Used 1 tool' }).click();
      await expect(
        page.getByText('Didn’t run a program that may send email').first()
      ).toBeVisible();
      await expect(
        page.getByText('Allowed for this session by you')
      ).toBeVisible();
      await blocked.getByRole('button', { name: 'Review permissions' }).click();
      await expect(page.locator('body')).toHaveAttribute(
        'data-opened-settings',
        'Agents'
      );
      await shot(page, `blocked-${language}`, isMobile);
    });

    test('the approver approves a held program', async ({ page, isMobile }) => {
      await page.goto(fixture(`language=${language}`));
      const request = page.getByRole('region', {
        name: 'Permission approval request',
      });
      await expect(request).toContainText('Approval needed');
      await expect(request).toContainText(
        'Scout wants to run a program that may:'
      );
      await expect(request).toContainText('Rename document');
      await request.getByRole('button', { name: 'View program' }).click();
      await expect(request).toContainText(program);
      // Long lines wrap, so nothing the person approves is cut off.
      const source = request.locator('pre');
      expect(
        await source.evaluate((pre) => pre.scrollWidth <= pre.clientWidth)
      ).toBe(true);
      await shot(page, `approval-${language}`, isMobile);
      await request.getByRole('button', { name: 'Hide program' }).click();
      await request
        .getByRole('button', { name: 'Approve', exact: true })
        .click();
      await expect(request).toHaveCount(0);
    });
  });
}

test('the settings set action defaults and entity exceptions', async ({
  page,
  isMobile,
}) => {
  await page.goto(fixture('view=page'));
  await expect(
    page.getByText(
      'Applies to every program Scout runs in sessions where agent permissions are on.'
    )
  ).toBeVisible();
  await expect(
    page.getByText('Scout’s other tools and your connected apps', {
      exact: false,
    })
  ).toBeVisible();
  const control = (
    scope: import('@playwright/test').Page | import('@playwright/test').Locator,
    name: string
  ) => scope.getByRole('radiogroup', { name });
  await expect(
    control(page, 'Delete default permission').getByRole('radio', {
      name: 'Never',
    })
  ).toBeChecked();
  await shot(page, 'settings-collapsed', isMobile);

  // Read: two exceptions, the other entities follow the default.
  await page.getByRole('button', { name: /^Read(?! default)/ }).click();
  const read = page.getByRole('region', { name: 'Read exceptions' });
  await expect(
    control(read, 'Contacts & CRM: Read').getByRole('radio', { name: 'Ask' })
  ).toBeChecked();
  await expect(
    control(read, 'Outside chats: Read').getByRole('radio', { name: 'Never' })
  ).toBeChecked();
  await expect(read).toContainText(
    'The other 4 entities follow the Read default.'
  );
  await shot(page, 'settings-read', isMobile);

  // Add exception → Email → Ask.
  await read.getByRole('button', { name: 'Add a Read exception' }).click();
  await expect(
    page.getByRole('menuitem', { name: 'Contacts & CRM' })
  ).toHaveCount(0);
  await shot(page, 'settings-choose-entity', isMobile);
  await page.getByRole('menuitem', { name: 'Email' }).click();
  const email = control(read, 'Email: Read');
  await expect(email).toBeVisible();
  await shot(page, 'settings-choose-permission', isMobile);
  await email.getByText('Ask', { exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute(
    'data-saved',
    /"email.read":"ask"/
  );
  await expect(read).toContainText(
    'The other 3 entities follow the Read default.'
  );

  // Its ✕ (Use default) removes it.
  await read
    .getByRole('button', { name: 'Email: use default (Allow)' })
    .click();
  await expect(page.locator('body')).not.toHaveAttribute(
    'data-saved',
    /email.read/
  );

  // The Send default.
  await control(page, 'Send default permission')
    .getByText('Allow', { exact: true })
    .click();
  await expect(page.locator('body')).toHaveAttribute(
    'data-defaults',
    /^(?!.*send)/
  );
  await shot(page, 'settings-changed', isMobile);
});

test('a ShowPermissions card saves a change', async ({ page, isMobile }) => {
  await page.goto(fixture('pending=0'));
  const card = page.getByRole('region', { name: 'Scout’s permissions' });
  await expect(card).toContainText(
    '“I need to send the weekly report to the team, but sending email is set to Ask.”'
  );
  const send = card.getByRole('radiogroup', { name: 'Email: Send' });
  await expect(send.getByRole('radio', { name: 'Ask' })).toBeChecked();
  await shot(page, 'show-permissions', isMobile);
  await send.getByText('Allow', { exact: true }).click();
  // Allow is the default here, so the card clears the exception.
  await expect(page.locator('body')).toHaveAttribute(
    'data-saved',
    /"email.destroy":"never"/
  );
  await expect(page.locator('body')).not.toHaveAttribute(
    'data-saved',
    /email.send/
  );
  await expect(send.getByRole('radio', { name: 'Allow' })).toBeChecked();
});

test('someone else sees the cards read-only and can only stop waiting', async ({
  page,
  isMobile,
}) => {
  await page.goto(fixture('viewer=other'));
  const request = page.getByRole('region', {
    name: 'Permission approval request',
  });
  await expect(request).toContainText('Waiting for Dana to approve');
  await expect(
    request.getByRole('button', { name: 'Approve', exact: true })
  ).toHaveCount(0);
  await expect(request.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(
    page.getByText('Only people who can edit Scout can change these.')
  ).toBeVisible();
  await expect(
    page.getByText('Only people who can edit Scout can change this.')
  ).toBeVisible();
  const send = page.getByRole('radiogroup', { name: 'Email: Send' });
  await expect(send.getByRole('radio', { name: 'Never' })).toBeDisabled();
  await shot(page, 'readonly', isMobile);
});
