import {
  attachGlobalDOMScope,
  registerHotkey,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { activeScope, setActiveScope } from '@core/hotkey/state';
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/solid-query';
import {
  createMemo,
  createRoot,
  createSignal,
  onCleanup,
  Suspense,
} from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSplitAutofocus } from '../utils/createSplitAutofocus';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));

const disposers: (() => void)[] = [];

afterEach(() => {
  cleanup();
  for (const dispose of disposers.splice(0)) dispose();
  document.body.replaceChildren();
  setActiveScope('global');
});

function setup(connected = false, enabled = true) {
  const shell = document.createElement('div');
  shell.tabIndex = -1;
  if (connected) document.body.appendChild(shell);
  const root = createRoot((dispose) => {
    disposers.push(dispose);
    const [isEnabled, setEnabled] = createSignal(enabled);
    createSplitAutofocus({ element: () => shell, enabled: isEnabled });
    return { dispose, setEnabled };
  });
  return { shell, ...root };
}

describe('split shell autofocus', () => {
  it('focuses an attached shell once and preserves later user focus', async () => {
    const { shell } = setup(true);
    await Promise.resolve();
    expect(document.activeElement).toBe(shell);

    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    document.body.appendChild(document.createElement('div'));
    await Promise.resolve();
    expect(document.activeElement).toBe(button);
  });

  it('waits for a detached shell to attach', async () => {
    const { shell } = setup();
    await Promise.resolve();
    expect(document.activeElement).toBe(document.body);

    document.body.appendChild(shell);
    await Promise.resolve();
    expect(document.activeElement).toBe(shell);
  });

  it.each(['input', 'button', 'div'] as const)(
    'preserves a focused %s when the shell attaches',
    async (tag) => {
      const { shell } = setup();
      await Promise.resolve();
      const other = document.createElement(tag);
      other.tabIndex = 0;
      document.body.appendChild(other);
      other.focus();

      document.body.appendChild(shell);
      await Promise.resolve();
      expect(document.activeElement).toBe(other);
    }
  );

  it('preserves focus already inside the split', async () => {
    const { shell } = setup();
    const input = document.createElement('input');
    shell.appendChild(input);
    await Promise.resolve();
    document.body.appendChild(shell);
    input.focus();
    await Promise.resolve();
    expect(document.activeElement).toBe(input);
  });

  it('does not autofocus an inactive split when it is later activated', async () => {
    const { shell, setEnabled } = setup(true, false);
    await Promise.resolve();
    setEnabled(true);
    await Promise.resolve();
    expect(document.activeElement).toBe(document.body);
    expect(shell.isConnected).toBe(true);
  });

  it('rechecks activation before focusing a late attachment', async () => {
    const { shell, setEnabled } = setup();
    await Promise.resolve();
    setEnabled(false);
    document.body.appendChild(shell);
    await Promise.resolve();
    expect(document.activeElement).toBe(document.body);
  });

  it.each([false, true])(
    'cancels on disposal with observer started=%s',
    async (started) => {
      const { shell, dispose } = setup();
      if (started) await Promise.resolve();
      dispose();
      document.body.appendChild(shell);
      await Promise.resolve();
      expect(document.activeElement).toBe(document.body);
    }
  );

  it('activates the split hotkey scope after an outer cold query attaches it', async () => {
    let resolveQuery!: (data: string[]) => void;
    const pendingQuery = new Promise<string[]>((resolve) => {
      resolveQuery = resolve;
    });
    const client = new QueryClient();
    const down = vi.fn();
    const up = vi.fn();
    let scopeId!: string;
    let shell!: HTMLDivElement;

    function Split() {
      const [attachHotkeys, scope] = useHotkeyDOMScope('fresh-load');
      scopeId = scope;
      const [element, setElement] = createSignal<HTMLDivElement | null>(null);
      createSplitAutofocus({ element, enabled: () => true });
      for (const [hotkey, handler] of [
        ['j', down],
        ['k', up],
      ] as const) {
        const hotkeyRegistration = registerHotkey({
          scopeId: scope,
          hotkey,
          description: 'Navigate list',
          keyDownHandler: () => {
            handler();
            return true;
          },
        });
        onCleanup(hotkeyRegistration.dispose);
      }
      return (
        <div
          ref={(el) => {
            shell = el;
            setElement(el);
            attachHotkeys(el);
          }}
          tabIndex={-1}
        >
          <Suspense>
            <div role="grid" aria-label="Email" tabIndex={0} />
          </Suspense>
        </div>
      );
    }

    function LoadingShell() {
      const query = useQuery(() => ({
        queryKey: ['cold-shell'],
        queryFn: () => pendingQuery,
      }));
      createMemo(() => query.data);
      return (
        <Suspense>
          <Split />
        </Suspense>
      );
    }

    function App() {
      useHotKeyRoot();
      return (
        <div ref={attachGlobalDOMScope}>
          <QueryClientProvider client={client}>
            <Suspense fallback={<div>Loading</div>}>
              <LoadingShell />
            </Suspense>
          </QueryClientProvider>
        </div>
      );
    }

    const view = render(() => <App />);
    await Promise.resolve();
    expect(shell.isConnected).toBe(false);
    expect(activeScope()).toBe('global');

    resolveQuery([]);
    await waitFor(() => expect(document.activeElement).toBe(shell));
    expect(activeScope()).toBe(scopeId);

    fireEvent.keyDown(shell, { key: 'j' });
    fireEvent.keyUp(shell, { key: 'j' });
    fireEvent.keyDown(shell, { key: 'k' });
    fireEvent.keyUp(shell, { key: 'k' });
    expect(down).toHaveBeenCalledOnce();
    expect(up).toHaveBeenCalledOnce();
    view.unmount();
    client.clear();
  });
});
