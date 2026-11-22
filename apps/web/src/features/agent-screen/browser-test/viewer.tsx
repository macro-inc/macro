import '@fontsource-variable/inter';
import '@app/index.css';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { FloatRegionHost } from '@components/app/mobile/float-regions/FloatRegionHost';
import type { ComponentMeta } from '@components/app/split-layout/componentRegistry';
import { PopoverSplitRenderer } from '@components/app/split-layout/components/PopoverSplitRenderer';
import { useSplitDisplayName } from '@components/app/split-layout/layoutUtils';
import { ok } from 'neverthrow';
import { createSignal, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import { macroDarkTheme } from '../../theme/themes/macro-dark';
import { macroLightTheme } from '../../theme/themes/macro-light';
import type { ScreenCapabilities } from '../context/screen-context';
import { agentScreenContent } from '../core/route';
import { createScreenInput } from '../primitives/screen-input';
import { createScreenSession } from '../primitives/screen-session';
import type { ScreenState } from '../transports/types';
import { AgentScreen } from '../views/agent-screen';
import { MobileAgentScreen } from '../views/mobile/agent-screen';
import type { AgentScreenModel } from '../views/shared/agent-screen-model';

/**
 * The real desktop and phone screen viewers over a stand-in transport that
 * draws a white guest desktop. `?view=desktop|phone|popout`,
 * `?state=watch|drive|other|reconnect|toomany|stopped` (see `capabilities`),
 * `?width=<px>` for the desktop split, `?theme=dark`.
 */
const params = new URLSearchParams(location.search);
document.documentElement.dataset.themeLight = String(
  params.get('theme') !== 'dark'
);
const theme = params.get('theme') === 'dark' ? macroDarkTheme : macroLightTheme;
for (const [token, value] of Object.entries(theme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}

const view = params.get('view') ?? 'desktop';
const scenario = params.get('state') ?? 'watch';
const width = Number(params.get('width') ?? 600);
const agentName = params.get('name') ?? 'Eve';

function serverState(): ScreenState {
  return {
    driver:
      scenario === 'drive'
        ? { name: 'Alex Rivera', isYou: true }
        : scenario === 'other'
          ? { name: 'Sam', isYou: false }
          : null,
    agentHeld: scenario !== 'other',
    waking: false,
    transport: 'vnc',
    viewers: 1,
    drivingHere: scenario === 'drive' ? true : undefined,
  };
}

/** A white guest desktop, as an agent's browser usually is. */
function drawGuest(element: HTMLElement) {
  const guest = document.createElement('div');
  element.append(guest);
  guest.innerHTML = `
    <div style="width:1280px;height:800px;background:#fff;font:20px sans-serif;color:#222;display:flex;flex-direction:column">
      <div style="height:56px;background:#f3f3f3;border-bottom:1px solid #ddd;display:flex;align-items:center;padding:0 20px;gap:12px">
        <span style="width:14px;height:14px;border-radius:7px;background:#e66"></span>
        <span style="width:14px;height:14px;border-radius:7px;background:#eb5"></span>
        <span style="width:14px;height:14px;border-radius:7px;background:#5b5"></span>
        <span style="margin-left:24px;flex:1;height:32px;border-radius:16px;background:#fff;border:1px solid #ddd;padding:4px 16px">example.test/inbox</span>
      </div>
      <div style="padding:40px 60px;line-height:1.8">
        <h1 style="font-size:34px;margin:0 0 16px">Inbox</h1>
        <p style="margin:0">Quarterly report draft — reply by Friday</p>
        <p style="margin:0">Design review notes</p>
        <p style="margin:0">Invoice #2041</p>
      </div>
    </div>`;
}

let connects = 0;

/**
 * The stand-in transport. `?state=reconnect`: live, then the socket drops and
 * the next connect never finishes; `toomany`: the harness refuses the socket
 * for one screen too many; `stopped`: Stop watching ends it as the harness
 * does.
 */
const capabilities: ScreenCapabilities = {
  requestTicket: async () =>
    ok({ socketUrl: 'wss://screen.test/ws?ticket=t1', expiresAt: '' }),
  transport: () => ({
    kind: 'vnc',
    connect: async (element, _ticket, handlers) => {
      connects += 1;
      if (scenario === 'toomany') {
        handlers.onError({
          code: 'tooManySockets',
          message: 'too many screens are open on this computer',
        });
        handlers.onEnded('error');
        throw new DOMException('refused', 'AbortError');
      }
      if (scenario === 'reconnect' && connects > 1)
        return await new Promise<never>(() => {});
      drawGuest(element);
      setTimeout(() => {
        handlers.onFrameSize({ width: 1280, height: 800 });
        handlers.onState(serverState());
        if (scenario === 'reconnect')
          setTimeout(() => handlers.onEnded('error'), 300);
      });
      return {
        sendInput: () => {},
        takeOver: () => {},
        handBack: () => {},
        stop: () => setTimeout(() => handlers.onEnded('stopped')),
        close: () => {},
      };
    },
  }),
};

function Viewer(props: { phone: boolean }) {
  const session = createScreenSession({
    harnessId: 'harness-1',
    canDrive: () => true,
    accessKnown: () => true,
    transport: () => 'vnc',
    capabilities,
  });
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const input = createScreenInput({
    frame: () => session.store.frame,
    container: size,
    rotation: () => 0,
    sendsInput: session.drivingMe,
    send: (event) => session.sendInput(event),
    onHandBackHold: () => session.handBack(null),
    isMac: false,
  });
  const model: AgentScreenModel = {
    harnessId: 'harness-1',
    agentName: () => agentName,
    canDrive: () => true,
    session,
    input,
    setContainerSize: setSize,
    driverName: () => session.store.server?.driver?.name ?? undefined,
    retry: () => session.retry(),
    turnOn: () => undefined,
  };
  return (
    <Show when={props.phone} fallback={<AgentScreen model={model} />}>
      <MobileAgentScreen model={model} />
    </Show>
  );
}

/** A desktop split: the app's split header above the view. */
function DesktopSplit() {
  return (
    <div class="flex min-h-screen bg-page p-4 text-ink">
      <div
        data-testid="pane"
        class="flex flex-col overflow-hidden rounded-xl border border-edge-frame bg-panel"
        style={{ width: `${width}px`, height: '640px' }}
      >
        <div class="flex h-10 shrink-0 items-center justify-between border-b border-edge-divider pr-2">
          <div id="split-header-left" class="flex min-w-0 items-center" />
          <div id="split-header-right" class="flex items-center gap-1" />
        </div>
        <div class="min-h-0 flex-1">
          <Viewer phone={false} />
        </div>
      </div>
    </div>
  );
}

/** A phone: the floating header, the view, and the app's dock and New. */
function Phone() {
  return (
    <div class="relative h-dvh w-full overflow-hidden bg-panel text-ink">
      <div class="absolute inset-x-0 top-0 z-10 flex h-14 items-center justify-between gap-2 px-2 pt-2">
        <div id="split-header-left" class="flex min-w-0 items-center" />
        <div id="split-header-right" class="flex items-center" />
      </div>
      <div class="size-full [--mobile-content-inset-top:3.5rem]">
        <Viewer phone />
      </div>
      {/* Stand-ins for the dock and the New button the app contributes. */}
      <FloatRegion region="dock" priority={0}>
        <div
          data-testid="dock"
          class="island pointer-events-auto mx-(--mobile-chrome-gutter) flex h-12 items-center justify-around rounded-full text-xs"
        >
          <For each={['Inbox', 'Chat', 'Agents', 'Files']}>
            {(label) => <span>{label}</span>}
          </For>
        </div>
      </FloatRegion>
      <FloatRegion region="accessory" priority={-1}>
        <div class="flex justify-end px-(--mobile-chrome-gutter)">
          <span
            data-testid="new-button"
            class="island pointer-events-auto rounded-full px-4 py-2 text-sm"
          >
            + New
          </span>
        </div>
      </FloatRegion>
      <FloatRegionHost navigationEdge="bottom" />
    </div>
  );
}

/** As the route does: the split (here the popover) is named after the agent. */
function NamedViewer() {
  useSplitDisplayName(() => agentName);
  return <Viewer phone={false} />;
}

/** Popped out: the real popover renderer, as `popoverSplit({ wide })` opens it. */
function PopOut() {
  const [meta, setMeta] = createStore<ComponentMeta>({});
  const popover = {
    id: 'popover-1',
    content: agentScreenContent('harness-1'),
    mount: {
      kind: 'component' as const,
      name: 'agent-screen',
      element: () => <NamedViewer />,
      meta,
      updateMeta: (data: Omit<ComponentMeta, 'kind'>) => setMeta(data),
    },
    isOpen: true,
    options: { content: agentScreenContent('harness-1'), wide: true },
  };
  return (
    <div class="min-h-screen bg-page p-8 text-ink">
      <p class="text-sm text-ink-muted">The conversation behind the pop-out.</p>
      <PopoverSplitRenderer popovers={() => new Map([[popover.id, popover]])} />
    </div>
  );
}

const root = document.getElementById('root');
if (root)
  render(() => {
    if (view === 'popout') return <PopOut />;
    return view === 'phone' ? <Phone /> : <DesktopSplit />;
  }, root);
