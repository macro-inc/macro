import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HomepageInteractiveDemo } from './HomepageInteractiveDemo';

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  // JSDOM has no default animation-name; presence detection expects `none`.
  const styles = document.createElement('style');
  styles.textContent = '* { animation-name: none; }';
  styles.id = 'test-animation-default';
  document.head.append(styles);
});
afterEach(() => {
  cleanup();
  document.getElementById('test-animation-default')?.remove();
  vi.restoreAllMocks();
});

it('loads the standalone demo only on demand and restores focus when closed', async () => {
  render(() => <HomepageInteractiveDemo />);
  expect(document.querySelector('iframe')).toBeNull();
  const trigger = screen.getByRole('button', { name: 'Interactive demo' });
  trigger.focus();
  fireEvent.click(trigger);
  await screen.findByRole('dialog', { name: 'Macro · Interactive demo' });
  expect(
    screen.getByTitle('Macro interactive sample workspace').getAttribute('src')
  ).toBe('/demo');
  fireEvent.click(
    screen.getByRole('button', { name: 'Close interactive demo' })
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.querySelector('iframe')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

it('lets inner controls handle Escape, then closes from inside the frame or the red traffic light', async () => {
  render(() => <HomepageInteractiveDemo />);
  const trigger = screen.getByRole('button', { name: 'Interactive demo' });
  fireEvent.click(trigger);
  const frame = (await screen.findByTitle(
    'Macro interactive sample workspace'
  )) as HTMLIFrameElement;
  frame.contentDocument!.append(frame.contentDocument!.createElement('html'));
  frame.contentDocument!.documentElement.append(
    frame.contentDocument!.createElement('body')
  );
  fireEvent.load(frame);
  const innerDialog = frame.contentDocument!.createElement('div');
  innerDialog.setAttribute('role', 'dialog');
  frame.contentDocument!.body.append(innerDialog);
  innerDialog.addEventListener('keydown', () => innerDialog.remove());
  innerDialog.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  );
  await Promise.resolve();
  expect(screen.getByRole('dialog')).toBeTruthy();

  const handled = new KeyboardEvent('keydown', {
    key: 'Escape',
    cancelable: true,
  });
  handled.preventDefault();
  frame.contentDocument!.dispatchEvent(handled);
  expect(screen.getByRole('dialog')).toBeTruthy();
  frame.contentDocument!.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(trigger);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Close demo window' })
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
