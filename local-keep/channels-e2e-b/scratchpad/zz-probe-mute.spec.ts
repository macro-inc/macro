import { ChannelView, conversationRow } from './harness/channel';
import { expect, test } from './harness/fixtures';
import { mutedBell } from './harness/sidebar';

// Scratch probe for UNR-06, not part of the suite: what happens to the key
// when Enter on "Until I turn it off" leaves the submenu open.
test('P-MUTE where Enter goes', async ({ page, ada, people }) => {
  await page.addInitScript(() => {
    const log: string[] = [];
    (window as unknown as { __log: string[] }).__log = log;
    const start = performance.now();
    const say = (line: string) =>
      log.push(`${Math.round(performance.now() - start)} ${line}`);
    const name = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return String(el);
      return `${el.tagName}[${el.getAttribute('role') ?? ''}|${
        el.getAttribute('data-mute-option') ?? ''
      }|${(el.textContent ?? '').slice(0, 24)}|connected=${el.isConnected}]`;
    };
    for (const type of ['keydown', 'keyup', 'focusin', 'focusout']) {
      window.addEventListener(
        type,
        (event) => {
          const key = (event as KeyboardEvent).key ?? '';
          say(
            `${type} ${key} target=${name(event.target)} active=${name(document.activeElement)} prevented=${event.defaultPrevented}`
          );
        },
        true
      );
    }
    window.addEventListener('keydown', (event) => {
      say(
        `keydown-bubbled ${event.key} prevented=${event.defaultPrevented} active=${name(document.activeElement)}`
      );
    });
    const watch = () => {
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.removedNodes) {
            if (
              node instanceof HTMLElement &&
              (node.matches('[data-mute-option],[role=menu]') ||
                node.querySelector('[data-mute-option]'))
            ) {
              say(`removed ${name(node)}`);
            }
          }
          for (const node of record.addedNodes) {
            if (
              node instanceof HTMLElement &&
              (node.matches('[data-mute-option],[role=menu]') ||
                node.querySelector('[data-mute-option]'))
            ) {
              say(`added ${name(node)}`);
            }
          }
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.documentElement) watch();
    else document.addEventListener('DOMContentLoaded', watch);
  });

  const stem = `pm-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const open = await ada.createChannel({
    name: `${stem}-open`,
    members: [people.ben],
  });
  const muted = await ada.createChannel({
    name: `${stem}-muted`,
    members: [people.ben],
  });
  await ada.post(muted.id, 'before muting');
  await new ChannelView(page, open.id).open();
  const row = conversationRow(page, `${stem}-muted`);
  await expect(row).toBeVisible();

  const menu = page.getByRole('menu');
  await expect(async () => {
    if ((await menu.count()) === 0) await row.click({ button: 'right' });
    const item = page.getByRole('menuitem', { name: 'Mute notifications' });
    await item.press('ArrowRight', { timeout: 2000 });
    await expect(item).toHaveAttribute('aria-expanded', 'true', {
      timeout: 2000,
    });
    await page.evaluate(() =>
      (window as unknown as { __log: string[] }).__log.push('--- press Enter')
    );
    await page
      .getByRole('menuitem', { name: 'Until I turn it off' })
      .press('Enter', { timeout: 2000 });
  }).toPass();

  const held = await mutedBell(row)
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(
      () => true,
      () => false
    );
  const log = await page.evaluate(
    () => (window as unknown as { __log: string[] }).__log
  );
  const mark = log.lastIndexOf('--- press Enter');
  const enter = log.findIndex((l, i) => i > mark && l.includes('keydown Enter'));
  const remade = log.findIndex(
    (l, i) => i > mark && l.includes('added DIV[menuitem|mute')
  );
  const target = enter < 0 ? 'none' : log[enter].includes('target=BODY') ? 'body' : 'item';
  console.log(
    `PMUTE-RUN held=${held} remadeBeforeEnter=${remade >= 0 && (enter < 0 || remade < enter)} enterTarget=${target}`
  );
  expect(held).toBe(true);
});
