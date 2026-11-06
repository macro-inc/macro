import '@fontsource-variable/inter';
import '../../../../index.css';
import {
  attachGlobalDOMScope,
  registerHotkey,
  useHotKeyRoot,
} from '@core/hotkey/hotkeys';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { ScreenProvider } from '../../context/screen-context';
import { connectScreen } from '../../queries/novnc';
import { ScreenPane } from '../../views/screen-pane';

// noVNC inspects only the immediate prototype of the WebSocket transport.
// Playwright's routed socket inherits part of that public API one level deeper.
const Socket = window.WebSocket;
window.WebSocket = new Proxy(Socket, {
  construct(target, args) {
    const socket = Reflect.construct(target, args);
    let prototype = Object.getPrototypeOf(socket);
    while (prototype && prototype !== Object.prototype) {
      for (const [key, descriptor] of Object.entries(
        Object.getOwnPropertyDescriptors(prototype)
      )) {
        if (key !== 'constructor' && !Object.hasOwn(socket, key))
          Object.defineProperty(socket, key, {
            ...descriptor,
            enumerable: true,
          });
      }
      prototype = Object.getPrototypeOf(prototype);
    }
    return socket;
  },
});

function Fixture() {
  useHotKeyRoot();
  const [shortcuts, setShortcuts] = createSignal(0);
  const [open, setOpen] = createSignal(true);
  registerHotkey({
    scopeId: 'global',
    hotkey: ['h', 't'],
    description: 'Fixture app navigation',
    runWithInputFocused: true,
    keyDownHandler: () => {
      setShortcuts((count) => count + 1);
      return true;
    },
  });
  return (
    <div ref={attachGlobalDOMScope} class="h-dvh flex flex-col">
      <button type="button">Outside screen</button>
      <output aria-label="App shortcuts">{shortcuts()}</output>
      <div class="min-h-0 flex-1">
        <ScreenProvider
          value={{
            host: {
              sessionId: () => 'fixture-session',
              harnessId: () => 'fixture-runtime',
              title: () => 'Keyboard computer',
              canEdit: () => !location.search.includes('read'),
              mobile: isTouchDevice,
              resolveUrl: async (_id, control) =>
                `wss://keyboard.invalid/screen?control=${control}`,
            },
            available: () => true,
            open,
            setOpen,
          }}
        >
          <ScreenPane connect={connectScreen} />
        </ScreenProvider>
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
