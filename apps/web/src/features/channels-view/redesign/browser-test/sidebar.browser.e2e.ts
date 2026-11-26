import { expect, test } from '@playwright/test';

test.describe('Channel Sidebar Redesign — Desktop (120 channels)', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop test suite');

  test('eliminates cross-section duplication, bounds DMs, and preserves zero horizontal overflow', async ({
    page,
  }) => {
    await page.goto('/');
    const sidebar = page.locator('[data-channel-sidebar-redesign]');
    await expect(sidebar).toBeVisible();

    // 1. Cross-section deduplication: launch-q4 and eng-frontend belong to both
    //    Personal "My Launch Focus" and Team "Engineering" -> must appear ONCE
    //    inside sections (Favorites/Pinned is its own top shortcut strip).
    const sectionsArea = sidebar.locator('[data-placed-section]');
    await expect(
      sectionsArea.locator('[data-channel-id="launch-q4"]')
    ).toHaveCount(1);
    await expect(
      sectionsArea.locator('[data-channel-id="eng-frontend"]')
    ).toHaveCount(1);

    // 2. Bounded DM smart window: 7 visible out of 35 total with "Show 28 more DMs"
    const dmSection = sidebar.locator('[data-dm-section]');
    await expect(dmSection.locator('[data-sidebar-row]')).toHaveCount(7);
    await expect(dmSection.getByText('Show 28 more DMs')).toBeVisible();

    // 3. People vs Agents DM filter chips
    await dmSection.locator('[data-dm-filter="agents"]').click();
    await expect(dmSection.locator('[data-sidebar-row]')).toHaveCount(6);
    await expect(dmSection.getByText('Release Bot')).toBeVisible();

    await dmSection.locator('[data-dm-filter="all"]').click();
    await dmSection.locator('[data-dm-show-more]').click();
    await expect(dmSection.locator('[data-sidebar-row]')).toHaveCount(35);
    await dmSection.getByText('Show fewer DMs').click();
    await expect(dmSection.locator('[data-sidebar-row]')).toHaveCount(7);

    // 4. Zero horizontal overflow on the 256px sidebar (even with long channel names & all 4 lens tabs!)
    const overflow = await sidebar.evaluate(
      (el) => el.scrollWidth - el.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('Support Desk operational buckets, stripped names, search, and live Jev classification', async ({
    page,
  }) => {
    await page.goto('/?jev=live');
    const sidebar = page.locator('[data-channel-sidebar-redesign]');
    await expect(sidebar).toBeVisible();

    // Switch to Support Desk lens
    await sidebar.locator('[data-lens-tab="support"]').click();
    const supportPanel = sidebar.locator('[data-sidebar-lens-panel="support"]');
    await expect(supportPanel).toBeVisible();

    // Jev engine upgrades from heuristic to active Jev badge
    await expect(supportPanel.getByText('Jev', { exact: true })).toBeVisible();

    // Urgent customer Orbit Cloud sits at top of Needs reply with stripped name
    const needsReply = supportPanel.locator(
      '[data-support-bucket="needs_reply"]'
    );
    await expect(needsReply).toContainText('Orbit Cloud');
    await expect(needsReply).toContainText('Urgent');
    // Resolved customer Driftwood Labs ("Thanks, that fixed it!") does NOT sit in Needs reply
    await expect(needsReply).not.toContainText('Driftwood Labs');

    // Inline customer filter narrows cleanly
    await supportPanel.getByPlaceholder('Filter customers…').fill('Orbit');
    await expect(needsReply.locator('[data-sidebar-row]')).toHaveCount(1);
    await expect(needsReply).toContainText('Orbit Cloud');
  });

  test('Focus lens, hover Mark read, and Mark all read sweep', async ({
    page,
  }) => {
    await page.goto('/');
    const sidebar = page.locator('[data-channel-sidebar-redesign]');
    await sidebar.locator('[data-lens-tab="focus"]').click();

    const focusPanel = sidebar.locator('[data-sidebar-lens-panel="focus"]');
    await expect(focusPanel).toContainText('Direct & @mentions');
    await expect(focusPanel).toContainText('eng-incidents');
    await expect(focusPanel).toContainText('Support waiting');

    // Sweep unread messages via Mark all read
    await focusPanel.getByRole('button', { name: 'Mark all read' }).click();
    // Unread-only badge disappears once all unread items are cleared
    await expect(
      sidebar.locator('[data-unread-only-toggle]')
    ).not.toContainText(/\d+/);
  });

  test('Quick Switch (Cmd+J) ranks joined above discoverable, joins inline, and jumps to channel', async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('[data-quick-switch-trigger]').click();

    const dialog = page.locator('[data-quick-switch-dialog]');
    await expect(dialog).toBeVisible();

    const input = dialog.getByPlaceholder('Jump to channel or person…');
    // Search for stripped customer name
    await input.fill('Orbit');
    await expect(dialog).toContainText('Macro Support x Orbit Cloud');

    // Search for unjoined discoverable channel and join inline
    await input.fill('design-systems');
    const discoverGroup = dialog.locator('[data-qs-group="discover"]');
    await expect(discoverGroup).toContainText('design-systems');
    await discoverGroup.getByRole('button', { name: 'Join' }).click();
    // After joining, it moves out of Discover into Joined!
    await expect(dialog.locator('[data-qs-group="joined"]')).toContainText(
      'design-systems'
    );

    // Pressing Enter opens the selected channel
    await input.press('Enter');
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('[data-selected-channel-name]')).toHaveText(
      'design-systems'
    );
  });

  test('Smart Organize with Jev dialog previews and moves ungrouped channels', async ({
    page,
  }) => {
    await page.goto('/?jev=live');
    await page.locator('[data-view-options-trigger]').click();
    await page.locator('[data-open-smart-organize]').click();

    const dialog = page.locator('[data-smart-organize-dialog]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('eng-perf-audit');
    await dialog.getByRole('button', { name: /^Move \d+ channel/ }).click();
    await expect(dialog).not.toBeVisible();
  });

  test('personal Hide & Restore of shared team section and keyboard navigation', async ({
    page,
  }) => {
    await page.goto('/');
    const sidebar = page.locator('[data-channel-sidebar-redesign]');

    // Open section menu on Alerts & Ops and hide personally
    const opsSection = sidebar.locator('[data-placed-section="sec-ops"]');
    await opsSection.scrollIntoViewIfNeeded();
    await opsSection.locator('[data-section-heading]').hover();
    await opsSection
      .getByRole('button', { name: /Alerts & Ops/ })
      .last()
      .click();
    await page.getByText('Hide from my sidebar').click();

    await expect(opsSection).toHaveCount(0);
    const hiddenBar = sidebar.locator('[data-hidden-sections-bar]');
    await expect(hiddenBar).toContainText('1 hidden team section');

    // Restore brings it right back
    await hiddenBar.getByRole('button', { name: 'Restore all' }).click();
    await expect(
      sidebar.locator('[data-placed-section="sec-ops"]')
    ).toHaveCount(1);

    // Keyboard lens switching (2 -> Focus, 3 -> Support, 1 -> All)
    await sidebar.focus();
    await page.keyboard.press('2');
    await expect(
      sidebar.locator('[data-sidebar-lens-panel="focus"]')
    ).toBeVisible();
    await page.keyboard.press('3');
    await expect(
      sidebar.locator('[data-sidebar-lens-panel="support"]')
    ).toBeVisible();
    await page.keyboard.press('1');
    await expect(sidebar.locator('[data-dm-section]')).toBeVisible();
  });

  test('renders dark mode, empty state, and loading skeleton cleanly', async ({
    page,
  }) => {
    // Dark mode
    await page.goto('/?theme=dark');
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme-dark',
      'true'
    );
    await expect(page.locator('[data-channel-sidebar-redesign]')).toBeVisible();

    // Loading state
    await page.goto('/?mode=loading');
    await expect(page.locator('[data-channel-sidebar-redesign]')).toBeVisible();

    // Empty state
    await page.goto('/?mode=empty');
    await expect(page.locator('[data-channel-sidebar-redesign]')).toBeVisible();
    await page.locator('[data-lens-tab="focus"]').click();
    await expect(page.getByText('All caught up')).toBeVisible();
  });

  test('supports drag-and-drop regrouping onto a custom section and narrow 680px viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 680, height: 900 });
    await page.goto('/');
    const sidebar = page.locator('[data-channel-sidebar-redesign]');
    await expect(sidebar).toBeVisible();

    const engSection = sidebar.locator('[data-placed-section="sec-eng"]');
    const targetRow = sidebar
      .locator('[data-channel-id="eng-perf-audit"]')
      .first();
    await targetRow.scrollIntoViewIfNeeded();
    await expect(targetRow).toBeVisible();

    // Drag eng-perf-audit onto Engineering section
    const sourceBox = await targetRow.boundingBox();
    await engSection.scrollIntoViewIfNeeded();
    const targetBox = await engSection.boundingBox();
    expect(sourceBox).toBeTruthy();
    expect(targetBox).toBeTruthy();

    await targetRow.scrollIntoViewIfNeeded();
    const freshSource = await targetRow.boundingBox();
    const freshTarget = await engSection.boundingBox();
    if (freshSource && freshTarget) {
      await page.mouse.move(
        freshSource.x + freshSource.width / 2,
        freshSource.y + freshSource.height / 2
      );
      await page.mouse.down();
      await page.mouse.move(
        freshTarget.x + freshTarget.width / 2,
        freshTarget.y + 14,
        { steps: 12 }
      );
      await page.mouse.up();
    }

    // Narrow 680px viewport still has zero horizontal overflow
    const overflow = await sidebar.evaluate(
      (el) => el.scrollWidth - el.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('Channel Sidebar Redesign — Phone (390px touch)', () => {
  test.skip(({ isMobile }) => !isMobile, 'Phone test suite');

  test('renders mobile PillTabs, Support Desk, DM People/Agents, personal Hide/Restore, and zero horizontal overflow', async ({
    page,
  }) => {
    await page.goto('/?surface=mobile');
    const mobile = page.locator('[data-channel-sidebar-mobile-redesign]');
    await expect(mobile).toBeVisible();

    // Zero horizontal overflow at 390px phone width
    const overflow = await mobile.evaluate(
      (el) => el.scrollWidth - el.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // Bounded DM window on All tab + expand & collapse right inside All + Agents filter
    const dmSec = mobile.locator('[data-mobile-dm-section]');
    await expect(dmSec.locator('[data-mobile-row]')).toHaveCount(7);
    await dmSec.locator('[data-mobile-dm-show-more]').click();
    await expect(dmSec.locator('[data-mobile-row]')).toHaveCount(35);
    await dmSec.locator('[data-mobile-dm-show-less]').click();
    await expect(dmSec.locator('[data-mobile-row]')).toHaveCount(7);
    await dmSec.locator('[data-mobile-dm-filter="agents"]').click();
    await expect(dmSec.locator('[data-mobile-row]')).toHaveCount(6);
    await expect(dmSec).toContainText('Release Bot');

    // Personal hide & restore of team section on phone
    const hideOps = mobile.locator('[data-mobile-hide-section="sec-ops"]');
    await hideOps.scrollIntoViewIfNeeded();
    await hideOps.click();
    await expect(mobile.locator('[data-mobile-section="sec-ops"]')).toHaveCount(
      0
    );
    const restoreBar = mobile.locator('[data-mobile-restore-hidden]');
    await expect(restoreBar).toContainText('1 hidden team section');
    await restoreBar.getByRole('button', { name: 'Restore all' }).click();
    await expect(mobile.locator('[data-mobile-section="sec-ops"]')).toHaveCount(
      1
    );

    // Switch to Support pill tab and verify operational buckets
    await mobile.locator('nav button:has-text("Support")').first().click();
    const supportPanel = mobile.locator('[data-mobile-panel="support"]');
    await expect(supportPanel).toBeVisible();
    await expect(
      supportPanel.locator('[data-mobile-support-bucket="needs_reply"]')
    ).toContainText('Orbit Cloud');

    // Switch to Focus pill tab and tap Mark all read
    await mobile.locator('nav button:has-text("Focus")').first().click();
    const focusPanel = mobile.locator('[data-mobile-panel="focus"]');
    await expect(focusPanel).toBeVisible();
    await focusPanel.getByRole('button', { name: 'Mark all read' }).click();
  });
});
