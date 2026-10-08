import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { ConnectedCalendars } from './connected-calendars';

afterEach(cleanup);

it('shows partial account visibility and toggles every calendar in the account', () => {
  const [hidden, setHidden] = createSignal(['holidays']);
  const ui = render(() => (
    <ConnectedCalendars
      accounts={[
        {
          id: 'work',
          email: 'work@example.com',
          canManage: true,
          needsPermission: false,
          calendars: [
            { id: 'primary', name: 'Work', color: '#123456' },
            { id: 'holidays', name: 'Holidays', color: '#654321' },
          ],
        },
      ]}
      loading={false}
      error={false}
      connecting={false}
      canConnect={true}
      onRetry={() => {}}
      onConnect={() => {}}
      onEnable={() => {}}
      onDisconnect={() => {}}
      isVisible={(id) => !hidden().includes(id)}
      onVisibilityChange={(ids, visible) =>
        setHidden((current) =>
          visible
            ? current.filter((id) => !ids.includes(id))
            : [...new Set([...current, ...ids])]
        )
      }
      accountColor={() => undefined}
      sourceColor={() => undefined}
      onAccountColor={() => {}}
      onSourceColor={() => {}}
    />
  ));
  const account = ui.getByRole('checkbox', {
    name: 'work@example.com',
  }) as HTMLInputElement;
  expect(account.indeterminate).toBe(true);
  fireEvent.click(account);
  expect(hidden()).toEqual([]);
  fireEvent.click(account);
  expect(hidden()).toEqual(['primary', 'holidays']);
  fireEvent.click(ui.getByRole('checkbox', { name: 'Holidays' }));
  expect(hidden()).toEqual(['primary']);
  expect(account.indeterminate).toBe(true);
});

it('keeps the color control mounted across updates and supports resetting the override', async () => {
  const [color, setColor] = createSignal<string>();
  const connect = vi.fn();
  const ui = render(() => (
    <ConnectedCalendars
      accounts={[
        {
          id: 'work',
          email: 'work@example.com',
          canManage: true,
          needsPermission: false,
          calendars: [
            { id: 'primary', name: 'Work', color: color() ?? '#123456' },
          ],
        },
      ]}
      loading={false}
      error={false}
      connecting={false}
      canConnect={true}
      onRetry={() => {}}
      onConnect={connect}
      onEnable={() => {}}
      onDisconnect={() => {}}
      isVisible={() => true}
      onVisibilityChange={() => {}}
      accountColor={() => undefined}
      sourceColor={() => color()}
      onAccountColor={() => {}}
      onSourceColor={(_, next) => setColor(next)}
    />
  ));
  const picker = ui.getByLabelText('Color for Work (work@example.com)');
  fireEvent.click(picker);
  const hex = await screen.findByRole('textbox', { name: 'Hex color' });
  fireEvent.input(hex, { target: { value: '#ff0000' } });
  fireEvent.keyDown(hex, { key: 'Enter' });
  expect(color()).toBe('#ff0000');
  expect(ui.getByLabelText('Color for Work (work@example.com)')).toBe(picker);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Reset Color for Work (work@example.com)',
    })
  );
  expect(color()).toBeUndefined();
  fireEvent.click(ui.getByRole('button', { name: 'Connect account' }));
  expect(connect).toHaveBeenCalledOnce();
});
