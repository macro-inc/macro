import {
  createContentPresentation,
  usePresentedContent,
} from '@components/app/split-layout/content-presentation';
import type {
  SplitId,
  SplitState,
} from '@components/app/split-layout/layoutManager';
import { createMobilePaneStack } from '@components/app/split-layout/mobile/createMobilePaneStack';
import { createMobileSplitMotion } from '@components/app/split-layout/mobile/createMobileSplitMotion';
import {
  finishNotificationNavigation,
  pendingNotificationNavigation,
  receiveNotificationTap,
} from '@notifications/notification-navigation-intent';
import { mockIPC } from '@tauri-apps/api/mocks';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { useNotificationCoverTimeout } from '../notification-launch';
import { createPushApi } from '../push-api';

const PREVIOUS = 'previous' as SplitId;
const DESTINATION = 'destination' as SplitId;
const ACKNOWLEDGMENTS: string[] = [];

function split(id: SplitId): SplitState {
  return {
    id,
    content: { type: 'component', id },
    referredFrom: null,
    lastNavigationCause: 'fresh',
    mount: {
      kind: 'component',
      name: id,
      element: () => null,
      meta: {},
      updateMeta() {},
    },
  };
}

function Fixture() {
  const [covered, setCovered] = createSignal(false);
  const [shellReady, setShellReady] = createSignal(true);
  const [splits, setSplits] = createSignal([split(PREVIOUS)]);
  const entryId = () => 'destination-entry';
  const presentation = createContentPresentation();
  const stack = createMobilePaneStack({ splits, getSplit: () => undefined });
  const motion = createMobileSplitMotion({
    stack,
    immediateOwner: () => presentation.pending()?.owner,
  });
  let viewport: HTMLDivElement | undefined;
  let destination: HTMLDivElement | undefined;
  let nativePending: string | undefined;
  window.__MACRO_IOS_NOTIFICATION_LAUNCH__ = true;
  mockIPC((command, payload) => {
    if (command === 'plugin:notifications|release_notification_cover') {
      setCovered(false);
      return;
    }
    if (command !== 'plugin:notifications|acknowledge_notification')
      throw new Error(`Unexpected command ${command}`);
    if (
      !payload ||
      !('deliveryId' in payload) ||
      payload.deliveryId !== nativePending
    )
      return;
    nativePending = undefined;
    setCovered(false);
    const rect = viewport?.getBoundingClientRect();
    const revealed = rect
      ? document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2
        )
      : null;
    ACKNOWLEDGMENTS.push(
      revealed?.closest('[data-screen]')?.getAttribute('data-screen') ?? 'none'
    );
  });
  const push = createPushApi('ios');
  useNotificationCoverTimeout();

  function DestinationShell() {
    usePresentedContent({
      presentation,
      owner: DESTINATION,
      entryId,
      element: () => destination ?? null,
      active: () => motion.presentedFront() === DESTINATION,
    });
    return <p>Destination loading shell</p>;
  }

  function openNotification() {
    const deliveryId = `delivery-${entryId()}`;
    nativePending = deliveryId;
    setCovered(true);
    receiveNotificationTap(
      {
        type: 'BACKGROUND_TAP',
        payload: { notificationId: deliveryId },
        deliveryId,
      },
      push.acknowledge
    );
    const intent = pendingNotificationNavigation();
    if (!intent) throw new Error('Missing notification intent');
    const present = presentation.prepare(() =>
      finishNotificationNavigation(intent)
    );
    setSplits([split(PREVIOUS), split(DESTINATION)]);
    present(DESTINATION, entryId());
  }

  const fixture = {
    openNotification,
    delayShell() {
      setShellReady(false);
    },
    mountShell() {
      setShellReady(true);
    },
    openOrdinary() {
      setSplits([split(PREVIOUS), split(DESTINATION)]);
    },
    snapshot() {
      return {
        covered: covered(),
        acknowledgments: [...ACKNOWLEDGMENTS],
        destinationTransform: motion.styleFor(true).transform,
        presented: motion.presentedFront(),
        pending: pendingNotificationNavigation()?.deliveryId,
      };
    },
  };
  window.notificationPresentationFixture = fixture;

  return (
    <>
      <button onClick={openNotification}>Open notification</button>
      <button onClick={fixture.openOrdinary}>Open ordinary pane</button>
      <div
        id="viewport"
        ref={viewport}
        data-presented={motion.presentedFront()}
      >
        <div
          class="screen"
          data-screen="previous"
          style={motion.styleFor(false)}
        >
          Previous screen
        </div>
        <Show when={stack.front() === DESTINATION}>
          <div
            class="screen"
            data-screen="destination"
            ref={destination}
            style={motion.styleFor(true)}
            onTransitionEnd={(event) => motion.handleTransitionEnd(event, true)}
          >
            <Show when={shellReady()}>
              <DestinationShell />
            </Show>
          </div>
        </Show>
        <Show when={covered()}>
          <div id="cover">Native cover fixture</div>
        </Show>
      </div>
    </>
  );
}

declare global {
  interface Window {
    notificationPresentationFixture: {
      openNotification(): void;
      delayShell(): void;
      mountShell(): void;
      openOrdinary(): void;
      snapshot(): {
        covered: boolean;
        acknowledgments: string[];
        destinationTransform: string;
        presented: SplitId | undefined;
        pending: string | undefined;
      };
    };
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
render(Fixture, root);
