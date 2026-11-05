import {
  TOAST_INVENTORY,
  type ToastInventoryEntry,
} from '@app/features/ui-gallery/toast-inventory';
import { defineDoc } from '@app/features/ui-gallery/types';
import { createMobileToastSwipe } from '@core/component/Toast/create-mobile-toast-swipe';
import { ToastContent, ToastType } from '@core/component/Toast/Toast';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import LinkIcon from '@icon/system/regular/link.svg';
import { Toast, toaster } from '@kobalte/core/toast';
import {
  type ComponentProps,
  createSignal,
  createUniqueId,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { Button } from './Button';
import { Input } from './Input';
import { Spinner } from './Spinner';
import { Tabs } from './Tabs';

type PreviewToast = Omit<ComponentProps<typeof ToastContent>, 'toastId'>;

// Each demo owns its records and simulation timers, never the app's regions.
function createToastPreview(options?: { appPosition?: boolean }) {
  const regionId = `toast-gallery-${createUniqueId()}`;
  const persistentRegionId = `${regionId}-persistent`;
  const ids = new Set<number>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let activeTransientId: number | undefined;

  const show = (content: PreviewToast) => {
    if (
      options?.appPosition &&
      isMobile() &&
      !content.persistent &&
      activeTransientId !== undefined
    ) {
      toaster.dismiss(activeTransientId);
    }
    const id = toaster.show(
      (props) => (
        <ToastContent
          {...content}
          toastId={props.toastId}
          onDismiss={() => {
            ids.delete(props.toastId);
            if (activeTransientId === props.toastId)
              activeTransientId = undefined;
            content.onDismiss?.();
          }}
        />
      ),
      {
        region:
          options?.appPosition && content.persistent
            ? persistentRegionId
            : regionId,
      }
    );
    ids.add(id);
    if (!content.persistent) activeTransientId = id;
    return id;
  };
  const dismiss = (id: number) => {
    toaster.dismiss(id);
    ids.delete(id);
  };
  const later = (callback: () => void, delay: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
    return () => {
      clearTimeout(timer);
      timers.delete(timer);
    };
  };
  const clear = () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const id of ids) toaster.dismiss(id);
    ids.clear();
    activeTransientId = undefined;
  };
  onCleanup(clear);
  return { regionId, persistentRegionId, show, dismiss, later, clear };
}

type ToastDemoProps = {
  preview?: ReturnType<typeof createToastPreview>;
};

function PreviewRegion(props: {
  preview: ReturnType<typeof createToastPreview>;
  label: string;
  stack?: boolean;
}) {
  return (
    <div
      class="min-h-40 w-full p-4"
      classList={{ 'max-w-lg': isMobile(), 'max-w-sm': !isMobile() }}
    >
      <Toast.Region
        regionId={props.preview.regionId}
        aria-label={props.label}
        class="macro-toast-region w-full"
        limit={3}
        duration={4500}
        pauseOnInteraction
        swipeDirection="right"
      >
        <Toast.List
          class="macro-toast-list"
          data-stack={props.stack ? '' : undefined}
        />
      </Toast.Region>
    </div>
  );
}

// #region demo:current-toasts
function CurrentToastPreview(props: { entry: ToastInventoryEntry }) {
  const preview = createToastPreview();
  const swipe = createMobileToastSwipe();
  const replay = () => {
    preview.clear();
    let id: number;
    id = preview.show({
      ...props.entry.create(() => preview.dismiss(id)),
      // Keep every specimen visible long enough to compare its presentation.
      persistent: true,
    });
  };
  onMount(replay);

  return (
    <article class="flex min-w-0 flex-col gap-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-xs text-ink-muted">{props.entry.category}</p>
          <h4 class="text-sm font-medium text-ink">{props.entry.name}</h4>
        </div>
        <Button variant="ghost" size="sm" onClick={replay}>
          Replay
        </Button>
      </div>
      <p class="text-xs text-ink-muted">{props.entry.trigger}</p>
      <div
        on:pointerdown={{ capture: true, handleEvent: swipe.onPointerDown }}
        on:pointermove={{ capture: true, handleEvent: swipe.onPointerMove }}
        on:pointerup={{ capture: true, handleEvent: swipe.clearSwipe }}
        on:pointercancel={{ capture: true, handleEvent: swipe.clearSwipe }}
      >
        <Toast.Region
          regionId={preview.regionId}
          aria-label={`${props.entry.name} preview`}
          class="macro-toast-region max-w-full"
          classList={{ 'w-full': isMobile(), 'w-95': !isMobile() }}
          swipeDirection={isMobile() ? swipe.direction() : 'right'}
        >
          <Toast.List class="macro-toast-list" />
        </Toast.Region>
      </div>
      <div class="mt-auto flex flex-col gap-1">
        <p class="text-xs text-ink-muted">{props.entry.behavior}</p>
        <code class="text-[11px] text-ink-extra-muted wrap-anywhere">
          src/{props.entry.source}
        </code>
      </div>
    </article>
  );
}

function CurrentToastsDemo() {
  const [search, setSearch] = createSignal('');
  const availableEntries = () =>
    TOAST_INVENTORY.filter((entry) => !entry.desktopOnly || !isTouchDevice());
  const entries = () => {
    const query = search().trim().toLowerCase();
    if (!query) return availableEntries();
    return availableEntries().filter((entry) =>
      `${entry.name} ${entry.category} ${entry.trigger} ${entry.source}`
        .toLowerCase()
        .includes(query)
    );
  };

  return (
    <div class="flex w-full flex-col gap-6">
      <div class="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          aria-label="Filter current app toasts"
          placeholder="Filter by toast, category, or source…"
          value={search()}
          onInput={(event) => setSearch(event.currentTarget.value)}
          class="w-full max-w-sm"
        />
        <span class="text-xs text-ink-muted">
          {entries().length} of {availableEntries().length} examples
        </span>
      </div>
      <div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] gap-x-8 gap-y-10">
        <For
          each={entries()}
          fallback={<p class="text-sm text-ink-muted">No matching toasts.</p>}
        >
          {(entry) => <CurrentToastPreview entry={entry} />}
        </For>
      </div>
    </div>
  );
}
// #endregion

// #region demo:notifications
function StatusesDemo(props: ToastDemoProps = {}) {
  const preview = props.preview ?? createToastPreview();
  return (
    <div class="flex w-full flex-col items-center gap-4">
      <div class="flex flex-wrap justify-center gap-2">
        <Button
          variant="secondary"
          onClick={() =>
            preview.show({
              toastType: ToastType.SUCCESS,
              message: 'Changes saved',
            })
          }
        >
          Success
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            preview.show({
              toastType: ToastType.ALERT,
              message: 'Attachment permissions',
              subtext:
                'Some recipients cannot open this attachment. Ask its owner to update access.',
            })
          }
        >
          Warning
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            preview.show({
              toastType: ToastType.FAILURE,
              message: 'Download failed',
              subtext: 'The file could not be downloaded. Try again.',
            })
          }
        >
          Failure
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            preview.show({
              toastType: ToastType.SUCCESS,
              message: 'Link copied',
              showCloseButton: false,
            })
          }
        >
          Without close button
        </Button>
        <Button variant="ghost" onClick={preview.clear}>
          Clear
        </Button>
      </div>
      <Show when={!props.preview}>
        <PreviewRegion preview={preview} label="Status previews" />
      </Show>
    </div>
  );
}
// #endregion

// #region demo:actions
function ActionsDemo(props: ToastDemoProps = {}) {
  const preview = props.preview ?? createToastPreview();
  const undo = () => {
    const id = preview.show({
      toastType: ToastType.SUCCESS,
      message: 'Email sent',
      duration: 5000,
      actionLayout: 'inline',
      dismissStyle: 'icon',
      actions: [
        {
          label: 'Undo',
          onClick: () => {
            preview.dismiss(id);
            preview.show({
              toastType: ToastType.SUCCESS,
              message: 'Send cancelled',
            });
          },
        },
      ],
    });
  };
  const prompt = () => {
    const id = preview.show({
      persistent: true,
      custom: {
        title: 'Reconnect email and calendar',
        content: () => 'Reconnect your account to resume syncing.',
        icon: LinkIcon,
        actions: [
          {
            label: 'Reconnect',
            onClick: () => {
              preview.dismiss(id);
              preview.show({
                toastType: ToastType.SUCCESS,
                message: 'Preview complete',
                subtext: 'No account settings were changed.',
              });
            },
          },
        ],
      },
    });
  };
  return (
    <div class="flex w-full flex-col items-center gap-4">
      <div class="flex flex-wrap justify-center gap-2">
        <Button variant="secondary" onClick={undo}>
          Undo send
        </Button>
        <Button variant="secondary" onClick={prompt}>
          Persistent prompt
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            preview.show({
              embed: () => (
                <div class="flex flex-col gap-1">
                  <Toast.Title class="text-base font-medium text-ink">
                    Custom content
                  </Toast.Title>
                  <Toast.Description class="text-sm text-ink-muted">
                    Embedded content retains the shared surface and dismissal
                    controls.
                  </Toast.Description>
                </div>
              ),
            })
          }
        >
          Embedded content
        </Button>
        <Button variant="ghost" onClick={preview.clear}>
          Clear
        </Button>
      </div>
      <Show when={!props.preview}>
        <PreviewRegion preview={preview} label="Action previews" />
      </Show>
    </div>
  );
}
// #endregion

// #region demo:async
function AsyncDemo(props: ToastDemoProps = {}) {
  const preview = props.preview ?? createToastPreview();
  const simulateOperation = (fail: boolean) => {
    preview.clear();
    let cancel: (() => void) | undefined;
    const id = preview.show({
      toastType: ToastType.LOADING,
      message: 'Moving files',
      persistent: true,
      onUserDismiss: () => cancel?.(),
      onDismiss: () => cancel?.(),
    });
    cancel = preview.later(() => {
      preview.dismiss(id);
      preview.show({
        toastType: fail ? ToastType.FAILURE : ToastType.SUCCESS,
        message: fail ? 'Some files could not be moved' : 'Files moved',
        subtext: fail
          ? 'Two files remain in their original folder.'
          : undefined,
      });
    }, 1800);
  };
  const simulateDownload = () => {
    preview.clear();
    const [progress, setProgress] = createSignal(0);
    let cancel: (() => void) | undefined;
    const id = preview.show({
      persistent: true,
      onUserDismiss: () => cancel?.(),
      onDismiss: () => cancel?.(),
      custom: {
        title: 'Downloading archive',
        icon: () => <Spinner size="md" decorative />,
        color: 'var(--color-accent)',
        content: () => (
          <div class="flex flex-col gap-2">
            <div
              role="progressbar"
              aria-label="Download progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress()}
              class="h-1.5 overflow-hidden rounded-full bg-border-tertiary"
            >
              <div
                class="h-full origin-left rounded-full bg-accent transition-transform duration-300 ease-linear motion-reduce:transition-none"
                style={{ transform: `scaleX(${progress() / 100})` }}
              />
            </div>
            <span class="text-xs text-ink-muted tabular-nums">
              {progress()} of 100 MB
            </span>
          </div>
        ),
        actions: [
          {
            label: 'Cancel',
            onClick: () => {
              cancel?.();
              preview.dismiss(id);
            },
          },
        ],
      },
    });
    const advance = () => {
      const next = Math.min(100, progress() + 10);
      setProgress(next);
      if (next === 100) {
        preview.dismiss(id);
        preview.show({
          toastType: ToastType.SUCCESS,
          message: 'Archive downloaded',
        });
        return;
      }
      cancel = preview.later(advance, 300);
    };
    cancel = preview.later(advance, 300);
  };
  return (
    <div class="flex w-full flex-col items-center gap-4">
      <div class="flex flex-wrap justify-center gap-2">
        <Button variant="secondary" onClick={() => simulateOperation(false)}>
          Loading to success
        </Button>
        <Button variant="secondary" onClick={() => simulateOperation(true)}>
          Loading to failure
        </Button>
        <Button variant="secondary" onClick={simulateDownload}>
          Download progress
        </Button>
        <Button variant="ghost" onClick={preview.clear}>
          Clear
        </Button>
      </div>
      <Show when={!props.preview}>
        <PreviewRegion preview={preview} label="Async previews" />
      </Show>
    </div>
  );
}
// #endregion

// #region demo:stack
function StackDemo(props: ToastDemoProps = {}) {
  const preview = props.preview ?? createToastPreview();
  const replay = () => {
    preview.clear();
    preview.show({
      toastType: ToastType.SUCCESS,
      message: 'Link copied',
      duration: 12000,
    });
    preview.later(
      () =>
        preview.show({
          toastType: ToastType.ALERT,
          message: 'Check attachment access',
          subtext: 'Recipients need permission before they can open the file.',
          duration: 12000,
        }),
      300
    );
    preview.later(
      () =>
        preview.show({
          toastType: ToastType.FAILURE,
          message: 'Download failed',
          duration: 12000,
        }),
      600
    );
    preview.later(
      () =>
        preview.show({
          toastType: ToastType.SUCCESS,
          message: 'Queued notice',
          subtext: 'A fourth notice waits until a slot is available.',
          duration: 12000,
        }),
      900
    );
  };
  return (
    <div class="flex w-full flex-col items-center gap-4">
      <div class="flex flex-wrap justify-center gap-2">
        <Button variant="secondary" onClick={replay}>
          Replay stack
        </Button>
        <Button variant="ghost" onClick={preview.clear}>
          Clear
        </Button>
      </div>
      <Show when={!props.preview}>
        <PreviewRegion preview={preview} label="Stack preview" stack />
      </Show>
    </div>
  );
}
// #endregion

// #region demo:app-position
function AppPositionDemo() {
  const preview = createToastPreview({ appPosition: true });
  const [example, setExample] = createSignal('statuses');
  const mobileSwipe = createMobileToastSwipe();

  return (
    <div class="flex w-full flex-col items-center gap-4">
      <Tabs
        aria-label="Toast examples at the app position"
        size="sm"
        options={[
          { value: 'statuses', label: 'Status' },
          { value: 'actions', label: 'Actions' },
          { value: 'async', label: 'Loading' },
          { value: 'stack', label: 'Stack' },
        ]}
        value={example()}
        onChange={(value) => {
          preview.clear();
          setExample(value);
        }}
      />
      <Switch>
        <Match when={example() === 'statuses'}>
          <StatusesDemo preview={preview} />
        </Match>
        <Match when={example() === 'actions'}>
          <ActionsDemo preview={preview} />
        </Match>
        <Match when={example() === 'async'}>
          <AsyncDemo preview={preview} />
        </Match>
        <Match when={example() === 'stack'}>
          <StackDemo preview={preview} />
        </Match>
      </Switch>
      <Portal>
        <div
          on:pointerdown={{
            capture: true,
            handleEvent: mobileSwipe.onPointerDown,
          }}
          on:pointermove={{
            capture: true,
            handleEvent: mobileSwipe.onPointerMove,
          }}
          on:pointerup={{ capture: true, handleEvent: mobileSwipe.clearSwipe }}
          on:pointercancel={{
            capture: true,
            handleEvent: mobileSwipe.clearSwipe,
          }}
          class={
            isMobile()
              ? 'fixed left-1/2 -translate-x-1/2 w-full max-w-lg px-(--mobile-chrome-gutter) pointer-events-none z-toast-region flex flex-col gap-5'
              : 'fixed bottom-5 right-5 m-0 w-95 max-w-[calc(100vw-32px)] pointer-events-none z-toast-region flex flex-col items-stretch gap-4'
          }
          style={
            isMobile()
              ? {
                  bottom:
                    'calc(var(--mobile-content-inset-bottom, 0px) + 12px)',
                }
              : undefined
          }
        >
          <Toast.Region
            regionId={preview.persistentRegionId}
            aria-label="Persistent toast previews at the app position"
            class="macro-toast-region"
            duration={Infinity}
            limit={1}
            pauseOnInteraction={false}
            swipeDirection={isMobile() ? mobileSwipe.direction() : 'right'}
          >
            <Toast.List class="macro-toast-list" />
          </Toast.Region>
          <Toast.Region
            regionId={preview.regionId}
            aria-label="Toast previews at the app position"
            class="macro-toast-region"
            limit={isMobile() ? 1 : 3}
            duration={4500}
            pauseOnInteraction
            swipeDirection={isMobile() ? mobileSwipe.direction() : 'right'}
          >
            <Toast.List
              class="macro-toast-list"
              data-stack={isMobile() ? undefined : ''}
            />
          </Toast.Region>
        </div>
      </Portal>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'Toast',
  wide: true,
  category: 'Feedback',
  description:
    'Standalone status icons, title-aligned content, primary actions, desktop close icons for undo notices, and compact mobile notices. Preview them inline or at the device-specific app position without triggering real operations or publishing into the app notification regions.',
  import: "import { toast } from '@core/component/Toast/Toast';",
  demos: [
    {
      id: 'current-toasts',
      title: 'Current app toasts',
      description:
        'Review real toast copy and actions with the current shared renderer. Examples stay open for inspection; their normal lifetime and platform are listed below. Actions only dismiss the preview: they never connect accounts, change settings, move files, or reload. Replay restores a dismissed example. Account details are synthetic.',
      render: CurrentToastsDemo,
      fill: true,
    },
    {
      id: 'app-position',
      title: 'App position',
      description:
        'Desktop toasts appear at the bottom-right; mobile toasts sit above the dock and swipe away in either direction without a close icon. Multi-row mobile cards use 92vw clamped between 320px and 480px, capped by the available width. Single-row notices stay content-sized, with 24px between the title and inline actions even when the action group wraps. These previews have their own queue, separate from real app notifications. Switching examples or leaving the page clears them.',
      render: AppPositionDemo,
      fill: true,
    },
    {
      id: 'notifications',
      title: 'Statuses and close controls',
      render: StatusesDemo,
      fill: true,
    },
    {
      id: 'actions',
      title: 'Inline undo, stacked prompts, and custom content',
      render: ActionsDemo,
      fill: true,
    },
    {
      id: 'async',
      title: 'Loading and progress',
      render: AsyncDemo,
      fill: true,
    },
    {
      id: 'stack',
      title: 'Desktop stack and queue',
      description:
        'Hover or focus to expand this three-card queue and pause dismissal. The app uses a separate, single transient slot on phones.',
      render: StackDemo,
      fill: true,
    },
  ],
  guidelines: {
    do: [
      'Use a short title and put supporting details in subtext.',
      'Reserve persistent prompts for notices that need a response.',
      'Keep action labels short and retain meaningful content on mobile.',
      'Keep Undo beside the title with a desktop close icon instead of Dismiss.',
      'Use Not now for optional setup prompts; keep Dismiss for recovery prompts.',
      'Omit the close icon on mobile; retain swipe dismissal in either direction.',
      'Set actionLayout to inline for brief notices; keep stacked actions for longer prompts.',
      'Use the existing toast service so queueing, timing, and dismissal stay consistent.',
      'Use the shared Spinner for loading; keep the progress bar for known progress.',
    ],
    dont: [
      'Use a toast for information that must remain in the page.',
      'Add custom surfaces, shadows, or animations in consumers.',
      'Hide the dismissal control on a persistent notice unless its content provides another way to dismiss.',
    ],
  },
});
