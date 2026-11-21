// The composer's namespace first, as the app loads it: notification
// navigation reaches it through a cycle that otherwise reads it too early.
import '@app/features/channel/Input/Input';
import '@fontsource-variable/inter';
import '../../../../index.css';
import { usePendingNotificationNavigationEffect } from '@app/features/notifications/PendingNotificationNavigationEffect';
import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  type Entry,
  type SplitRoutes,
} from '@app/lib/split-router';
import { SplitRouterProvider } from '@app/lib/split-router/solid/context';
import { paneRoute } from '@app/routes/app-route';
import {
  appRoute,
  homeSplitRoute,
  legacyContentRoute,
  notFoundRoute,
} from '@app/routes/routes';
import { setGlobalSplitManager } from '@app/signal/splitLayout';
import { SplitLayoutContext } from '@components/app/split-layout/context';
import {
  createSplitLayout,
  type SplitManager,
} from '@components/app/split-layout/layoutManager';
import { createMobilePaneStack } from '@components/app/split-layout/mobile/createMobilePaneStack';
import { MobileSplitContainer } from '@components/app/split-layout/mobile/MobileSplitContainer';
import { createAppPanePolicy } from '@components/app/split-layout/split-router/app-pane-policy';
import {
  resolveContentLocation,
  splitContentFromLocation,
} from '@components/app/split-layout/split-router/legacy-route';
import { blocks } from '@core/constant/allBlocks';
import { createBlockOrchestrator } from '@core/orchestrator';
import { receiveNotificationTap } from '@notifications/notification-navigation-intent';
import { mockIPC } from '@tauri-apps/api/mocks';
import { Button, Dialog } from '@ui';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { macroLightTheme } from '../../../../features/theme/themes/macro-light';
import { createPushApi } from '../../../../lib/tauri/push-api';
import { MobileDrawer } from '../MobileDrawer';
import { PickerSheet } from '../PickerSheet';

for (const [token, value] of Object.entries(macroLightTheme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}
document.documentElement.dataset.themeLight = 'true';

const RECIPIENT = 'macro|fixture@example.com';
const [pressed, setPressed] = createSignal<string[]>([]);
const press = (control: string) => setPressed((list) => [...list, control]);

/** A document with the sheets a page opens: stacked ones and a dialog. */
function DocumentPage() {
  const [properties, setProperties] = createSignal(false);
  const [picker, setPicker] = createSignal(false);
  const [rename, setRename] = createSignal(false);
  return (
    <div class="flex flex-col items-start gap-3 p-4 pt-16">
      <h1 class="text-lg font-semibold">Document</h1>
      <Button onClick={() => setProperties(true)}>Properties</Button>
      <Button onClick={() => setRename(true)}>Rename</Button>
      <MobileDrawer open={properties()} onOpenChange={setProperties}>
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content aria-label="Properties" targetHeight={60}>
            <MobileDrawer.Handle />
            <MobileDrawer.ScrollBody class="gap-3 px-6">
              <Button onClick={() => setPicker(true)}>Assignee</Button>
            </MobileDrawer.ScrollBody>
            <PickerSheet.Root open={picker()} onCancel={() => setPicker(false)}>
              <PickerSheet.Header
                title="Assignee"
                onDone={() => setPicker(false)}
              />
              <PickerSheet.Body>
                <input aria-label="Search people" class="m-4" />
              </PickerSheet.Body>
            </PickerSheet.Root>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
      <Dialog open={rename()} onOpenChange={setRename}>
        <Dialog.Title class="p-4">Rename document</Dialog.Title>
        <input aria-label="Name" class="m-4" />
      </Dialog>
    </div>
  );
}

/** A channel, with a sheet of its own for a tap on the channel already open. */
function ChannelPage() {
  const [members, setMembers] = createSignal(false);
  return (
    <div class="flex flex-col items-start gap-3 p-4 pt-16">
      <h1 class="text-lg font-semibold">Channel</h1>
      <Button onClick={() => press('Reply')}>Reply</Button>
      <Button onClick={() => setMembers(true)}>Members</Button>
      <MobileDrawer open={members()} onOpenChange={setMembers}>
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content aria-label="Members">
            <MobileDrawer.Handle />
            <MobileDrawer.Item>Ada</MobileDrawer.Item>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </div>
  );
}

Reflect.set(blocks, 'md', { name: 'md', component: DocumentPage });
Reflect.set(blocks, 'channel', { name: 'channel', component: ChannelPage });

const routes: SplitRoutes = {
  definitions: [
    {
      ...appRoute,
      children: [homeSplitRoute, legacyContentRoute, notFoundRoute],
    },
  ],
  defaultRoute: () => paneRoute({ id: 'view-home', params: {} }),
};

// The native notification bridge, answering as the iOS app does.
mockIPC((command) => {
  if (command === 'plugin:notifications|acknowledge_notification') return;
  if (command === 'plugin:notifications|release_notification_cover') return;
  throw new Error(`Unexpected native command: ${command}`);
});
const PUSH = createPushApi('ios');

function App() {
  let manager!: SplitManager;
  const router = createSplitRouter({
    routes,
    history: createMemoryHistory('/md/doc-one'),
    paneStore: createMemoryPaneStore<Entry>(),
    policy: createAppPanePolicy({
      manager: () => manager,
      toContent: splitContentFromLocation,
      defaultLocation: () => ({ route: routes.defaultRoute() }),
      stacked: () => true,
    }),
  });
  const orchestrator = createBlockOrchestrator();
  manager = createSplitLayout(orchestrator, {
    router,
    toLocation: (content) => resolveContentLocation(router.routes, content),
    toContent: splitContentFromLocation,
    stacked: () => true,
  });
  setGlobalSplitManager(manager);
  const stack = createMobilePaneStack(manager);
  usePendingNotificationNavigationEffect(
    { notifications: () => [] },
    () => RECIPIENT,
    () => true
  );

  Reflect.set(window, 'navigationFixture', {
    /** A notification tap the iOS app delivers, warm, for a channel message. */
    tapNotification: (channelId: string) =>
      receiveNotificationTap(
        {
          type: 'BACKGROUND_TAP',
          deliveryId: crypto.randomUUID(),
          payload: {
            notificationId: crypto.randomUUID(),
            recipientId: RECIPIENT,
            navigation: JSON.stringify({
              type: 'channel',
              channelId,
              messageId: crypto.randomUUID(),
              threadId: null,
            }),
          },
        },
        PUSH.acknowledge
      ),
    /** What an agent or a mention does: open content from code. */
    openChannel: (id: string) => manager.openWithSplit({ type: 'channel', id }),
    /** A link from outside the app. */
    followLink: (path: string) => router.navigate(path),
    pressed,
  });

  return (
    <SplitRouterProvider router={router}>
      <SplitLayoutContext.Provider value={{ manager }}>
        <div class="fixed inset-0 bg-page text-ink">
          <MobileSplitContainer
            splitManager={manager}
            stack={stack}
            splits={manager.splits}
            panelRefs={new Map()}
          />
        </div>
        {/* App chrome: never unmounts, whatever the panes show. */}
        <MobileDrawer>
          <MobileDrawer.Trigger as={Button} class="fixed right-4 bottom-8">
            Create
          </MobileDrawer.Trigger>
          <MobileDrawer.Portal>
            <MobileDrawer.Overlay />
            <MobileDrawer.Content aria-label="Create">
              <MobileDrawer.Handle />
              <MobileDrawer.Item onClick={() => press('Document')}>
                Document
              </MobileDrawer.Item>
            </MobileDrawer.Content>
          </MobileDrawer.Portal>
        </MobileDrawer>
      </SplitLayoutContext.Provider>
    </SplitRouterProvider>
  );
}

const root = document.getElementById('root');
if (root) render(() => <App />, root);
