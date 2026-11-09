import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const fixture =
  '/src/features/channels-view/components/rail/next/browser-test/sidebar.html';
const proof = '/tmp/chat-sidebar-proof';
mkdirSync(proof, { recursive: true });

test('keeps section editing and navigation usable in both themes', async ({
  page,
}, info) => {
  const phone = info.project.name.startsWith('phone');
  const light = info.project.name.endsWith('light');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/__macro_dev/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  );
  await page.goto(`${fixture}?${phone ? 'phone&' : ''}${light ? 'light' : ''}`);
  const capture = async (name: string) => {
    await page.screenshot({
      path: `${proof}/${info.project.name}-${name}.png`,
      fullPage: true,
    });
  };

  if (phone) {
    const all = page.getByRole('tab', { name: 'All', exact: true });
    await expect(all).toBeVisible();
    await expect(
      page.getByRole('tab', { name: 'Release', exact: true })
    ).toBeAttached();
    await capture('01-home');
    const pins = page.getByRole('group', { name: 'Pinned conversations' });
    expect(
      await pins.evaluate(
        (element) => element.scrollWidth > element.clientWidth
      )
    ).toBe(true);
    const release = page.getByRole('tab', { name: 'Release', exact: true });
    await release.click();
    await expect(release).toHaveAttribute('aria-selected', 'true');
    await expect(
      page.getByRole('button', { name: 'Join', exact: true })
    ).toBeVisible();
    await capture('02-section');
    await page.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Join', exact: true })
    ).toBeHidden();

    await page
      .getByRole('button', { name: 'Search conversations', exact: true })
      .click();
    const search = page.getByRole('searchbox', {
      name: 'Search conversations',
      exact: true,
    });
    await expect(search).toBeFocused();
    await expect(page.getByText('Not joined', { exact: true })).toBeVisible();
    await capture('03-search');
    await search.fill('release');
    await expect(page.getByText('Channels', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    const bounds = await release.boundingBox();
    expect(bounds).not.toBeNull();
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 },
      ],
    });
    await expect(
      page.getByRole('button', { name: 'Display', exact: true })
    ).toBeVisible();
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await capture('04-options');
    await page.getByRole('button', { name: 'Display', exact: true }).click();
    const unread = page.getByRole('switch', {
      name: 'Unread only',
      exact: true,
    });
    await expect(unread).toBeVisible();
    await page.getByText('Unread only', { exact: true }).click();
    await expect(unread).toBeChecked();
    await capture('display');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page
      .getByRole('button', { name: 'Add channels', exact: true })
      .click();
    await expect(
      page.getByRole('textbox', { name: 'Search channels', exact: true })
    ).toBeFocused();
    await capture('picker');
    await page
      .getByRole('dialog', { name: 'Add channels', exact: true })
      .getByText('product', { exact: true })
      .click();
    await expect(
      page.getByRole('textbox', { name: 'Search channels', exact: true })
    ).toBeFocused();
    await expect(
      page.getByRole('button', { name: 'Done', exact: true })
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Rename section', exact: true })
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Rename section', exact: true })
      .click();
    const name = page.getByRole('textbox', {
      name: 'Section name',
      exact: true,
    });
    await expect(name).toBeFocused();
    await name.fill('Renamed section');
    await name.press('Enter');
    await expect(
      page.getByRole('tab', { name: 'Renamed section', exact: true })
    ).toHaveAttribute('aria-selected', 'true');
    await page
      .getByRole('button', { name: 'Options for Renamed section', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Delete for everyone', exact: true })
      .click();
    await expect(all).toHaveAttribute('aria-selected', 'true');
  } else {
    await expect(
      page.getByRole('heading', { name: 'Chat', exact: true })
    ).toBeVisible();
    await capture('01-rest');
    await page
      .getByRole('button', { name: 'Search conversations', exact: true })
      .click();
    await expect(page.getByText('Not joined', { exact: true })).toBeVisible();
    await capture('02-search-empty');
    await page
      .getByRole('searchbox', { name: 'Search conversations', exact: true })
      .fill('release');
    await page.getByText('release-ops', { exact: true }).hover();
    await expect(
      page.getByRole('button', { name: 'Join', exact: true })
    ).toBeVisible();
    await capture('03-search-query');
    await page
      .getByRole('button', { name: 'Search conversations', exact: true })
      .click();

    await page
      .getByRole('button', {
        name: 'Create channel or direct message',
        exact: true,
      })
      .click();
    await page
      .getByRole('menuitem', { name: 'New section', exact: true })
      .click();
    const name = page.getByRole('textbox', {
      name: 'Section name',
      exact: true,
    });
    await expect(name).toBeFocused();
    await name.fill('Roadmap');
    await capture('04-inline');
    await name.press('Enter');
    await expect(name).toBeHidden();
    await capture('05-empty');

    await page
      .getByRole('button', { name: 'Add channels to “Roadmap”', exact: true })
      .click();
    const channelSearch = page.getByRole('textbox', {
      name: 'Search channels',
      exact: true,
    });
    await expect(channelSearch).toBeFocused();
    await page
      .getByRole('dialog')
      .getByText('product', { exact: true })
      .click();
    await expect(
      page.getByRole('checkbox', { name: 'product', exact: true })
    ).toBeChecked();
    await capture('07-picker');
    await page
      .getByRole('button', { name: 'Add 1 channel', exact: true })
      .click();
    await expect(channelSearch).toBeHidden();

    await page
      .getByRole('button', { name: 'Options for Release', exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: 'Match by name', exact: true })
      .click();
    const rule = page.getByRole('textbox', {
      name: 'Name contains',
      exact: true,
    });
    await expect(rule).toBeFocused();
    await rule.fill('release');
    await expect(
      page.getByText('2 matching channels', { exact: true })
    ).toBeVisible();
    await capture('06-match');
    await page
      .getByRole('button', { name: 'Save section', exact: true })
      .click();
    await expect(rule).toBeHidden();

    await page
      .getByRole('button', { name: 'Options for Release', exact: true })
      .click();
    await page.getByRole('menuitem', { name: /Visible to/ }).hover();
    await expect(
      page.getByRole('menuitemcheckbox', { name: 'Only me', exact: true })
    ).toBeVisible();
    await capture('08-visible');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page
      .getByRole('button', { name: 'Options for Release', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Display', exact: true }).hover();
    const collapsed = page.getByRole('menuitemcheckbox', {
      name: 'Unread when collapsed',
      exact: true,
    });
    await expect(collapsed).toHaveAttribute('aria-checked', 'true');
    await collapsed.click();
    await expect(collapsed).toHaveAttribute('aria-checked', 'false');
    await capture('08b-display');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await page
      .getByRole('button', { name: 'Options for Release', exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: 'Mute all channels', exact: true })
      .hover();
    await expect(
      page.getByRole('menuitem', { name: 'Until I turn it off', exact: true })
    ).toBeVisible();
    await capture('09-mute');
    await page.getByRole('menuitem', { name: /For 1 hour/ }).click();
    await page
      .getByRole('button', { name: 'Options for Release', exact: true })
      .click();
    await expect(
      page.getByRole('menuitem', { name: 'Unmute all channels', exact: true })
    ).toBeVisible();
    await page
      .getByRole('menuitem', { name: 'Unmute all channels', exact: true })
      .click();

    await page
      .getByText('product', { exact: true })
      .first()
      .click({ button: 'right' });
    await page
      .getByRole('menuitem', { name: 'Add to section', exact: true })
      .hover();
    await expect(
      page.getByRole('menuitemcheckbox', { name: 'Roadmap', exact: true })
    ).toHaveAttribute('aria-checked', 'true');
    await capture('10-add-to-section');
    await page
      .getByRole('menuitem', { name: 'New section', exact: true })
      .click();
    await expect(name).toBeFocused();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page
      .getByText('product', { exact: true })
      .first()
      .click({ button: 'right' });
    await page
      .getByRole('menuitem', { name: 'Mute channel', exact: true })
      .hover();
    await expect(
      page.getByRole('menuitem', { name: 'Custom…', exact: true })
    ).toBeVisible();
    await capture('11-channel-mute');
  }
  expect(errors).toEqual([]);
});
