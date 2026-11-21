import { expect, test } from '@playwright/test';

// All API data is local to this fixture; rich previews use its seeded cache.
test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const request = route.request();
    if (['fetch', 'xhr'].includes(request.resourceType()))
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{}',
      });
    return route.continue();
  });
  // Keep external analytics scripts from adding unrelated requests to the
  // assertion that this fixture never fetches CRM records.
  await page.route(
    (url) =>
      ['http:', 'https:'].includes(url.protocol) &&
      !['127.0.0.1', 'localhost'].includes(url.hostname),
    (route) => route.abort()
  );
  await page.routeWebSocket('**/*', (socket) => socket.close());
});

const mailboxId = '00000000-0000-4000-8000-000000000045';
test('mailbox domain refusals stay beside their input and existing exclusions stay removable', async ({
  page,
}) => {
  await page.goto('/?admin&mailbox-guard&flag-off');
  await page
    .getByRole('button', { name: 'Email settings', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  for (const [label, domain, explanation] of [
    [
      'Domain to block for the team',
      'example.com',
      "Colleagues on a mailbox's own company domain are already kept out of the CRM. Blocking this domain would hide all of that mailbox's email.",
    ],
    [
      'Domain to block for my emails',
      'gmail.com',
      "Blocking this domain would hide all of a connected mailbox's email from the CRM.",
    ],
  ]) {
    const input = dialog.getByRole('textbox', { name: label });
    const section = input.locator('xpath=ancestor::section');
    await expect(section.getByText(explanation, { exact: true })).toBeVisible();
    const remove = section.getByRole('button', {
      name: `Remove ${domain}`,
      exact: true,
    });
    await expect(remove).toBeEnabled();
    await input.fill(domain);
    await input
      .locator('..')
      .getByRole('button', { name: 'Add domain' })
      .click();
    const error = section.getByRole('alert');
    await expect(error).toHaveText(explanation);
    await expect(input).toHaveAttribute(
      'aria-describedby',
      (await error.getAttribute('id')) ?? ''
    );
    await expect(input).toHaveValue(domain);
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await input.fill('unrelated.example.org');
    await expect(error).toHaveCount(0);
    await input
      .locator('..')
      .getByRole('button', { name: 'Add domain' })
      .click();
    await expect(
      section.getByText('unrelated.example.org', { exact: true })
    ).toBeVisible();
    await expect(input).toHaveValue('');
    await remove.click();
    await expect(remove).toHaveCount(0);
    await expect(section.getByText(explanation, { exact: true })).toHaveCount(
      0
    );
  }
});

for (const admin of [false, true]) {
  test(`privacy controls and exact mailbox consent for ${admin ? 'admin' : 'member'}`, async ({
    page,
  }, testInfo) => {
    await page.goto(admin ? '/?admin' : '/');
    await page
      .getByRole('button', { name: 'Email settings', exact: true })
      .waitFor();
    await page
      .getByRole('button', { name: 'Email settings', exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText('member@example.com', { exact: true })
    ).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('privacy-review.png') });
    const teamRemove = dialog.getByRole('button', {
      name: 'Remove team.example.com',
      exact: true,
    });
    const personalRemove = dialog.getByRole('button', {
      name: 'Remove personal.example.com',
      exact: true,
    });
    if (admin) await expect(teamRemove).toBeEnabled();
    else await expect(teamRemove).toBeDisabled();
    await expect(personalRemove).toBeEnabled();
    await personalRemove.click();
    await expect(page.getByTestId('last-change')).toHaveText(
      JSON.stringify({
        action: 'remove_domain',
        scope: 'personal',
        domain: 'personal.example.com',
      })
    );
    const input = dialog.getByRole('textbox', {
      name: 'Domain to block for the team',
    });
    await input.fill('new.example.com');
    await input
      .locator('..')
      .getByRole('button', { name: 'Add domain' })
      .click();
    await expect(
      dialog.getByText('new.example.com', { exact: true })
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('privacy-controls.png'),
    });
    await dialog
      .getByRole('button', { name: 'Share my emails with CRM', exact: true })
      .click();
    await expect(page.getByTestId('last-change')).toHaveText(
      JSON.stringify({
        action: 'set_consent',
        enabled: true,
        link_id: mailboxId,
      })
    );
    await expect(dialog).not.toBeVisible();
    await page
      .getByRole('button', { name: 'Email settings', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Stop sharing my emails', exact: true })
      .click();
    await expect(page.getByTestId('last-change')).toHaveText(
      JSON.stringify({
        action: 'set_consent',
        enabled: false,
        link_id: mailboxId,
      })
    );
    await page.screenshot({
      path: testInfo.outputPath('privacy-withdrawn.png'),
    });
  });
}
test('disconnected mailbox cannot opt in while exclusions remain editable', async ({
  page,
}) => {
  await page.goto('/?disconnected');
  await page
    .getByRole('button', { name: 'Email settings', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'Email settings', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Share my emails with CRM', exact: true })
  ).toBeDisabled();
  await expect(
    page.getByRole('textbox', { name: 'Domain to block for my emails' })
  ).toBeEnabled();
});

test('banner opens review using the device input mode', async ({
  page,
}, testInfo) => {
  const phone = testInfo.project.name === 'phone';
  if (phone) await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Email settings', exact: true })
    .waitFor();
  const review = page.getByRole('button', {
    name: 'Review and opt in',
    exact: true,
  });
  await expect(review).toBeInViewport();
  if (phone) {
    await expect(page.locator('html')).toHaveAttribute(
      'data-touch-device',
      'true'
    );
    expect((await review.boundingBox())?.height).toBeGreaterThanOrEqual(36);
  }
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth
    )
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('privacy-banner.png') });
  if (phone) await review.tap();
  else await review.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText('member@example.com', { exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth
    )
  ).toBe(true);
  await expect(
    dialog.getByRole('button', {
      name: 'Share my emails with CRM',
      exact: true,
    })
  ).toBeEnabled();
});

test('owner can inspect and remove a private-thread exception', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Email settings', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'Email settings', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  const remove = dialog.getByRole('button', {
    name: 'Remove Private conversation from excluded threads',
    exact: true,
  });
  await remove.scrollIntoViewIfNeeded();
  await expect(remove).toBeVisible();
  await expect(
    dialog.getByText('Private conversation', { exact: true })
  ).toBeVisible();
  await expect(
    dialog.getByText(/A teammate’s contributed copy can still be visible/)
  ).toBeVisible();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('thread-exclusion-settings.png'),
  });
  const paneCount = await page.getByTestId('panes').getByTestId('pane').count();
  await remove.click();
  await expect(page.getByTestId('panes').getByTestId('pane')).toHaveCount(
    paneCount
  );
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('last-change')).toHaveText(
    JSON.stringify({
      action: 'set_thread_exclusion',
      thread_id: '00000000-0000-4000-8000-000000000046',
      excluded: false,
    })
  );
  await expect(
    dialog.getByText('No excluded threads.', { exact: true })
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('thread-exclusion-removed.png'),
  });
});

test('own thread action creates an exception using the device menu', async ({
  page,
}, testInfo) => {
  await page.goto('/?contributing');
  await page
    .getByRole('button', { name: 'Email settings', exact: true })
    .waitFor();
  const trigger = page.getByRole('button', {
    name: 'Thread actions',
    exact: true,
  });
  if (testInfo.project.name === 'phone') await trigger.tap();
  else await trigger.click();
  const action = page.getByText('Exclude thread from CRM', { exact: true });
  await expect(action).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath('thread-exclusion-menu.png'),
  });
  if (testInfo.project.name === 'phone') await action.tap();
  else await action.click();
  await expect(page.getByTestId('last-change')).toHaveText(
    JSON.stringify({
      action: 'set_thread_exclusion',
      thread_id: '00000000-0000-4000-8000-000000000049',
      excluded: true,
    })
  );
});

test('thread action is unavailable for a teammate copy', async ({
  page,
}, testInfo) => {
  await page.goto('/?teammate');
  await page
    .getByRole('button', { name: 'Email settings', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'Thread actions', exact: true })
    .click();
  await expect(
    testInfo.project.name === 'phone'
      ? page.getByRole('dialog', { name: 'Thread actions', exact: true })
      : page.getByRole('menu')
  ).toBeVisible();
  await expect(
    page.getByRole(testInfo.project.name === 'phone' ? 'button' : 'menuitem', {
      name: /Exclude thread from CRM/,
    })
  ).toBeDisabled();
});

test('owner can page through excluded threads and return to the first page', async ({
  page,
}) => {
  await page.goto('/?paged');
  await page
    .getByRole('button', { name: 'Email settings', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'Email settings', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(
    dialog.getByText('Another private conversation', { exact: true })
  ).toBeVisible();
  await expect(
    dialog.getByText('Private conversation', { exact: true })
  ).toHaveCount(0);
  await dialog
    .getByRole('button', { name: 'Back to first page', exact: true })
    .click();
  await expect(
    dialog.getByText('Private conversation', { exact: true })
  ).toBeVisible();
  await dialog
    .getByRole('button', {
      name: 'Remove Private conversation from excluded threads',
      exact: true,
    })
    .click();
  await expect(
    dialog.getByText('Another private conversation', { exact: true })
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Next page', exact: true })
  ).toHaveCount(0);
});

test('cursor page survives deletion of an earlier exclusion', async ({
  page,
}, info) => {
  test.skip(
    info.project.name === 'phone',
    'Uses the desktop header in another view.'
  );
  await page.goto('/?paged&contributing&excluded');
  await page
    .getByRole('button', { name: 'Email settings', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'Email settings', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(
    dialog.getByText('Another private conversation', { exact: true })
  ).toBeVisible();
  // Simulate another open view changing an earlier row while this page stays mounted.
  await page
    .locator('button[aria-label="Remove from excluded threads"]')
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByTestId('toast')).toHaveText(
    'Thread removed from excluded threads.'
  );
  await expect(
    dialog.getByText('Another private conversation', { exact: true })
  ).toBeVisible();
  await expect(
    dialog.getByText('No excluded threads.', { exact: true })
  ).toHaveCount(0);
});

test('disabled rollout keeps the thread action and exception settings unavailable', async ({
  page,
}) => {
  await page.goto('/?flag-off');
  await page
    .getByRole('button', { name: 'Email settings', exact: true })
    .waitFor();
  await expect(
    page.getByRole('button', { name: 'Exclude thread from CRM', exact: true })
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Thread actions', exact: true })
    .click();
  await expect(
    page.getByText('Exclude thread from CRM', { exact: true })
  ).toHaveCount(0);
  await page.getByText('Copy link', { exact: true }).click();
  await page
    .getByRole('button', { name: 'Email settings', exact: true })
    .click();
  await expect(page.getByText('Excluded threads', { exact: true })).toHaveCount(
    0
  );
  await expect(
    page.getByRole('textbox', { name: 'Domain to block for my emails' })
  ).toBeEnabled();
});

for (const [query, reason] of [
  ['', 'Your email isn’t shared with CRM.'],
  ['contributing&teammate', 'This thread is not in your mailbox.'],
  ['contributing&other-mailbox', 'This mailbox isn’t shared with CRM.'],
  ['no-team', 'Join a team to share email with CRM.'],
  [
    'contributing&status-unavailable',
    'Could not check CRM email sharing. Try again.',
  ],
]) {
  test(`thread privacy explains why it is disabled: ${query || 'no consent'}`, async ({
    page,
  }, info) => {
    await page.goto(`/?${query}`);
    await page
      .getByRole('button', { name: 'Email settings', exact: true })
      .waitFor();
    if (info.project.name === 'desktop') {
      const button = page.getByRole('button', {
        name: 'Exclude thread from CRM',
        exact: true,
      });
      await expect(button).toHaveAttribute('aria-disabled', 'true');
      await button.focus();
      await expect(page.getByRole('tooltip')).toContainText(reason);
      await button.press('Enter');
      await expect(page.getByTestId('last-change')).toBeEmpty();
    }
    await page
      .getByRole('button', { name: 'Thread actions', exact: true })
      .click();
    const action = page.getByRole(
      info.project.name === 'phone' ? 'button' : 'menuitem',
      { name: /Exclude thread from CRM/ }
    );
    await expect(action).toBeDisabled();
    if (info.project.name === 'phone')
      await expect(action).toContainText(reason);
    else {
      await page.getByRole('menu').press('Home');
      await page.keyboard.press('ArrowDown');
      await expect(action).toBeFocused();
      await expect(action).toHaveAccessibleDescription(reason);
      // The modal menu hides external portals from screen readers; its row
      // description supplies the accessible reason while the tooltip is visible.
      const tooltip = page.getByRole('tooltip', { includeHidden: true });
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toContainText(reason);
      await action.press('Enter');
      await expect(page.getByTestId('last-change')).toBeEmpty();
    }
  });
}

test('existing exclusions remain removable after contribution is withdrawn', async ({
  page,
}, info) => {
  await page.goto('/?excluded');
  await page
    .getByRole('button', { name: 'Email settings', exact: true })
    .waitFor();
  if (info.project.name === 'desktop') {
    const restore = page.getByRole('button', {
      name: 'Remove from excluded threads',
      exact: true,
    });
    await expect(restore).toHaveAttribute('aria-pressed', 'true');
    await expect(restore).toHaveAttribute('aria-disabled', 'false');
    await restore.click();
  } else {
    await page
      .getByRole('button', { name: 'Thread actions', exact: true })
      .click();
    const restore = page.getByRole('button', {
      name: 'Remove from excluded threads',
      exact: true,
    });
    await expect(restore).toBeEnabled();
    await restore.click();
  }
  await expect(page.getByTestId('last-change')).toHaveText(
    JSON.stringify({
      action: 'set_thread_exclusion',
      thread_id: '00000000-0000-4000-8000-000000000046',
      excluded: false,
    })
  );
  await expect(page.getByTestId('toast')).toHaveText(
    'Thread removed from excluded threads.'
  );
  if (info.project.name === 'desktop') {
    const exclude = page.getByRole('button', {
      name: 'Exclude thread from CRM',
      exact: true,
    });
    await expect(exclude).toHaveAttribute('aria-disabled', 'true');
    await exclude.focus();
    await expect(page.getByRole('tooltip')).toContainText(
      'Your email isn’t shared with CRM.'
    );
  }
});

test('failed status refresh preserves the cached exclusion and disables actions', async ({
  page,
}, info) => {
  await page.goto('/?contributing&excluded');
  await page
    .getByRole('button', { name: 'Email settings', exact: true })
    .waitFor();
  if (info.project.name === 'desktop') {
    await expect(
      page.getByRole('button', {
        name: 'Remove from excluded threads',
        exact: true,
      })
    ).toHaveAttribute('aria-pressed', 'true');
  } else {
    await page
      .getByRole('button', { name: 'Thread actions', exact: true })
      .click();
    await expect(
      page.getByRole('button', {
        name: 'Remove from excluded threads',
        exact: true,
      })
    ).toBeEnabled();
    await page.getByText('Copy link', { exact: true }).click();
  }
  await page
    .getByRole('button', { name: 'Fail thread status refresh' })
    .click();
  const reason = 'Could not check CRM email sharing. Try again.';
  if (info.project.name === 'desktop') {
    const button = page.getByRole('button', {
      name: 'Remove from excluded threads',
      exact: true,
    });
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await button.focus();
    await expect(page.getByRole('tooltip')).toContainText(reason);
    await button.press('Enter');
  }
  await page
    .getByRole('button', { name: 'Thread actions', exact: true })
    .click();
  const action = page.getByRole(
    info.project.name === 'phone' ? 'button' : 'menuitem',
    { name: /Remove from excluded threads/ }
  );
  await expect(action).toBeDisabled();
  if (info.project.name === 'phone') await expect(action).toContainText(reason);
  await expect(page.getByTestId('last-change')).toBeEmpty();
});

test('header exclusion and settings removal stay synchronized', async ({
  page,
}, info) => {
  test.skip(
    info.project.name === 'phone',
    'The phone header keeps actions in its title menu.'
  );
  await page.goto('/?contributing&excluded');
  await page
    .getByRole('button', { name: 'Email settings', exact: true })
    .waitFor();
  const restore = page.getByRole('button', {
    name: 'Remove from excluded threads',
    exact: true,
  });
  await expect(restore).toHaveAttribute('aria-pressed', 'true');
  await expect(restore).toHaveAttribute('aria-disabled', 'false');
  await page
    .getByRole('button', { name: 'Email settings', exact: true })
    .click();
  const remove = page.getByRole('button', {
    name: 'Remove Private conversation from excluded threads',
    exact: true,
  });
  await expect(remove).toHaveText('Remove');
  await remove.click();
  await expect(
    page.getByText('No excluded threads.', { exact: true })
  ).toBeVisible();
  await expect(page.getByTestId('panes').getByTestId('pane')).toHaveCount(1);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  const exclude = page.getByRole('button', {
    name: 'Exclude thread from CRM',
    exact: true,
  });
  await expect(exclude).toHaveAttribute('aria-pressed', 'false');
  await expect(exclude).toHaveAttribute('aria-disabled', 'false');
  await exclude.press('Enter');
  await expect(restore).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('toast')).toContainText(
    'Your thread is excluded from CRM.'
  );
  await restore.click();
  await expect(exclude).toBeVisible();
  await expect(page.getByTestId('toast')).toHaveText(
    'Thread removed from excluded threads.'
  );
});

for (const mode of ['click', 'shift-click', 'already-open', 'keyboard']) {
  test(`excluded thread mention uses split navigation: ${mode}`, async ({
    page,
  }, info) => {
    test.skip(
      info.project.name === 'phone' && mode === 'shift-click',
      'Desktop modifier navigation.'
    );
    await page.goto(`/?${mode === 'already-open' ? 'already-open' : ''}`);
    await page
      .getByRole('button', { name: 'Email settings', exact: true })
      .waitFor();
    const panes = page.getByTestId('panes').getByTestId('pane');
    await expect(panes.first()).toBeAttached();
    const initialCount = await panes.count();
    await page
      .getByRole('button', { name: 'Email settings', exact: true })
      .click();
    const link = page.getByRole('link', {
      name: 'Private conversation',
      exact: true,
    });
    await expect(link.locator('[data-document-mention]')).toHaveAttribute(
      'data-block-name',
      'email'
    );
    await expect(link.locator('svg')).toBeVisible();
    await expect(link.locator('.animate-pulse')).toHaveCount(0);
    if (mode === 'keyboard') {
      await expect(page.getByRole('dialog')).not.toHaveAttribute(
        'data-opening'
      );
      await page
        .getByRole('button', {
          name: 'Remove Private conversation from excluded threads',
          exact: true,
        })
        .focus();
      await page.keyboard.press('Shift+Tab');
      await expect(link).toBeFocused();
      await page.keyboard.press('Enter');
    } else
      await link.click({ modifiers: mode === 'shift-click' ? ['Shift'] : [] });
    await expect(page.getByRole('dialog')).toBeHidden();
    const thread = page.locator(
      '[data-testid="pane"][data-content="00000000-0000-4000-8000-000000000046"]'
    );
    await expect(thread).toHaveCount(1);
    await expect(thread).toHaveAttribute('data-active', 'true');
    if (mode === 'already-open') await expect(panes).toHaveCount(initialCount);
    if (mode === 'shift-click')
      await expect(panes).toHaveCount(initialCount + 1);
    await expect(page.getByTestId('last-change')).toBeEmpty();
  });
}

test('email mention preview opens its thread and dismisses settings', async ({
  page,
}, info) => {
  test.skip(
    info.project.name === 'phone',
    'Touch opens accessible mentions directly.'
  );
  const previewInputs: unknown[] = [];
  page.on('request', (request) => {
    if (!request.url().endsWith('/items/soup/graphql')) return;
    const body = request.postDataJSON();
    if (body?.operationName === 'ItemPreviews')
      previewInputs.push(body.variables.input);
  });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Email settings', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'Email settings', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  const mention = page.getByRole('link', {
    name: 'Private conversation',
    exact: true,
  });
  await expect(mention).toBeVisible();
  expect(previewInputs).toHaveLength(0);
  await mention.hover();
  const preview = page.getByRole('button', {
    name: 'Private conversation',
    exact: true,
  });
  await expect(preview).toBeVisible();
  expect(previewInputs).toEqual([
    expect.objectContaining({
      initial: expect.objectContaining({
        limit: 1,
        filters: expect.objectContaining({
          emailFilter: {
            tree: {
              literal: {
                threadId: '00000000-0000-4000-8000-000000000046',
              },
            },
          },
        }),
      }),
    }),
  ]);
  await expect(dialog).toBeVisible();
  await preview.click();
  await expect(dialog).toBeHidden();
  await expect(
    page.locator(
      '[data-testid="pane"][data-content="00000000-0000-4000-8000-000000000046"]'
    )
  ).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('last-change')).toBeEmpty();
});

test('denied members can open and remove their excluded threads without CRM record reads', async ({
  page,
}) => {
  const dataRequests: string[] = [];
  page.on('request', (request) => {
    if (['fetch', 'xhr'].includes(request.resourceType()))
      dataRequests.push(request.url());
  });
  await page.goto('/?no-access&contributing');
  await page
    .getByRole('button', { name: 'Email settings', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('button', { name: 'Stop sharing my emails', exact: true })
  ).toBeVisible();
  await expect(
    dialog.getByText('Excluded threads', { exact: true })
  ).toBeVisible();
  await expect(page.getByTestId('excluded-list-reads')).not.toHaveText('0');
  const thread = dialog.getByRole('link', {
    name: 'Private conversation',
    exact: true,
  });
  await expect(thread.locator('[data-document-mention]')).toHaveAttribute(
    'data-block-name',
    'email'
  );
  await thread.click();
  await expect(dialog).toBeHidden();
  await expect(
    page.locator(
      '[data-testid="pane"][data-content="00000000-0000-4000-8000-000000000046"]'
    )
  ).toHaveAttribute('data-active', 'true');
  await page
    .getByRole('button', { name: 'Email settings', exact: true })
    .click();
  await dialog
    .getByRole('button', {
      name: 'Remove Private conversation from excluded threads',
      exact: true,
    })
    .click();
  await expect(
    dialog.getByText('No excluded threads.', { exact: true })
  ).toBeVisible();
  await expect(page.getByTestId('last-change')).toHaveText(
    JSON.stringify({
      action: 'set_thread_exclusion',
      thread_id: '00000000-0000-4000-8000-000000000046',
      excluded: false,
    })
  );
  // Privacy I/O is the injected owner-scoped source; all other data reads are observable.
  expect(dataRequests).toEqual([]);
});
