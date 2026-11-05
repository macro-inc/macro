import '@fontsource-variable/inter';
import '../../../index.css';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Button } from '@ui';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { ComputerClaudeAccess } from '../../settings/computers/views/computer-claude-access';
import { macroLightTheme } from '../../theme/themes/macro-light';
import { ScreenProvider } from '../context/screen-context';
import { ScreenSplit } from '../views/screen-split';
import { ScreenToggle } from '../views/screen-toggle';

document.documentElement.dataset.themeLight = 'true';
for (const [token, value] of Object.entries(macroLightTheme.colorTokens))
  document.documentElement.style.setProperty(`--color-${token}`, value);
function Fixture() {
  const [open, setOpen] = createSignal(false);
  const [edit, setEdit] = createSignal(true);
  return (
    <div class="h-dvh">
      <ScreenProvider
        value={{
          host: {
            sessionId: () => 'session',
            harnessId: () => 'computer',
            canEdit: edit,
            mobile: isTouchDevice,
            resolveUrl: async (_id, control) =>
              control ? 'wss://screen?control=true' : 'wss://screen',
          },
          available: () => true,
          open,
          setOpen,
        }}
      >
        <ScreenSplit
          connect={async (target, _url, control, events) => {
            const desktop = document.createElement('div');
            desktop.textContent = control
              ? 'Remote desktop · control'
              : 'Remote desktop · watch';
            desktop.style.cssText =
              'background:#202020;color:white;height:100%;display:grid;place-items:center';
            target.append(desktop);
            events.connected();
            return { disconnect: () => desktop.remove() };
          }}
        >
          <div class="flex h-full flex-col gap-4 p-4">
            <div class="flex gap-2">
              <ScreenToggle />
              <Button onClick={() => setEdit(!edit())}>
                Toggle edit permission
              </Button>
            </div>
            <p>Session transcript remains mounted</p>
            <ComputerClaudeAccess
              harnessId="computer"
              canManage
              mode="macro_credits"
            />
          </div>
        </ScreenSplit>
      </ScreenProvider>
    </div>
  );
}
const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
