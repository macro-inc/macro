import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolTile } from './ToolTile';

afterEach(cleanup);

describe('tool connection toggle', () => {
  it('allows an initially connected tool to be unchecked and connected again', () => {
    const [connected, setConnected] = createSignal(true);
    const view = render(() => (
      <ToolTile
        name="Notion"
        icon={<svg />}
        connected={connected()}
        onConnect={() => setConnected(true)}
        onDisconnect={() => setConnected(false)}
      />
    ));
    const checked = view.getByRole('button', { name: 'Disconnect Notion' });
    expect(checked.hasAttribute('disabled')).toBe(false);
    expect(checked.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(checked);
    const unchecked = view.getByRole('button', { name: 'Connect Notion' });
    expect(unchecked.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(unchecked);
    expect(
      view
        .getByRole('button', { name: 'Disconnect Notion' })
        .getAttribute('aria-pressed')
    ).toBe('true');
  });

  it.each([false, true])(
    'keeps the current state while a request is pending (connected=%s)',
    (connected) => {
      const onConnect = vi.fn();
      const onDisconnect = vi.fn();
      const view = render(() => (
        <ToolTile
          name="Notion"
          icon={<svg />}
          connected={connected}
          busy
          onConnect={onConnect}
          onDisconnect={onDisconnect}
        />
      ));
      const button = view.getByRole('button');
      expect(button.hasAttribute('disabled')).toBe(true);
      expect(button.getAttribute('aria-pressed')).toBe(String(connected));
      fireEvent.click(button);
      expect(onConnect).not.toHaveBeenCalled();
      expect(onDisconnect).not.toHaveBeenCalled();
    }
  );
});
