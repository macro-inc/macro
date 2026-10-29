import { defineDoc } from '@app/features/ui-gallery/types';
import {
  ToastContent,
  ToastType,
} from '@core/component/Toast/Toast';
import LinkIcon from '@icon/system/regular/link.svg';
import Spinner from '@icon/system/regular/spinner.svg';
import { Toast, toaster } from '@kobalte/core/toast';
import { type ComponentProps, createSignal, createUniqueId, onCleanup } from 'solid-js';
import { Button } from './Button';

type PreviewToast = Omit<ComponentProps<typeof ToastContent>, 'toastId'>;

// Each demo owns its records and simulation timers, never the app's regions.
function createToastPreview() {
  const regionId = `toast-gallery-${createUniqueId()}`;
  const ids = new Set<number>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const show = (content: PreviewToast) => {
    const id = toaster.show(
      (props) => (
        <ToastContent
          {...content}
          toastId={props.toastId}
          onDismiss={() => {
            ids.delete(props.toastId);
            content.onDismiss?.();
          }}
        />
      ),
      { region: regionId }
    );
    ids.add(id);
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
  };
  onCleanup(clear);
  return { regionId, show, dismiss, later, clear };
}

function PreviewRegion(props: {
  preview: ReturnType<typeof createToastPreview>;
  label: string;
  stack?: boolean;
}) {
  return (
    <div class="min-h-40 w-full max-w-sm p-4">
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

// #region demo:notifications
function StatusesDemo() {
  const preview = createToastPreview();
  return (
    <div class="flex w-full flex-col items-center gap-4">
      <div class="flex flex-wrap justify-center gap-2">
        <Button
          variant="secondary"
          onClick={() => preview.show({
            toastType: ToastType.SUCCESS,
            message: 'Changes saved',
          })}
        >
          Success
        </Button>
        <Button
          variant="secondary"
          onClick={() => preview.show({
            toastType: ToastType.ALERT,
            message: 'Attachment permissions',
            subtext: 'Some recipients cannot open this attachment. Ask its owner to update access.',
          })}
        >
          Warning
        </Button>
        <Button
          variant="secondary"
          onClick={() => preview.show({
            toastType: ToastType.FAILURE,
            message: 'Download failed',
            subtext: 'The file could not be downloaded. Try again.',
          })}
        >
          Failure
        </Button>
        <Button
          variant="secondary"
          onClick={() => preview.show({
            toastType: ToastType.SUCCESS,
            message: 'Link copied',
            showCloseButton: false,
          })}
        >
          Without close button
        </Button>
        <Button variant="ghost" onClick={preview.clear}>Clear</Button>
      </div>
      <PreviewRegion preview={preview} label="Status previews" />
    </div>
  );
}
// #endregion

// #region demo:actions
function ActionsDemo() {
  const preview = createToastPreview();
  const undo = () => {
    const id = preview.show({
      toastType: ToastType.SUCCESS,
      message: 'Email sent',
      duration: 5000,
      actions: [{
        label: 'Undo',
        onClick: () => {
          preview.dismiss(id);
          preview.show({ toastType: ToastType.SUCCESS, message: 'Send cancelled' });
        },
      }],
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
          { label: 'Hide', onClick: () => preview.dismiss(id) },
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
        <Button variant="secondary" onClick={undo}>Undo send</Button>
        <Button variant="secondary" onClick={prompt}>Persistent prompt</Button>
        <Button
          variant="secondary"
          onClick={() => preview.show({
            embed: () => (
              <div class="flex flex-col gap-1">
                <Toast.Title class="text-base font-medium text-ink">Custom content</Toast.Title>
                <Toast.Description class="text-sm text-ink-muted">
                  Embedded content retains the shared surface and dismissal controls.
                </Toast.Description>
              </div>
            ),
          })}
        >
          Embedded content
        </Button>
        <Button variant="ghost" onClick={preview.clear}>Clear</Button>
      </div>
      <PreviewRegion preview={preview} label="Action previews" />
    </div>
  );
}
// #endregion

// #region demo:async
function AsyncDemo() {
  const preview = createToastPreview();
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
        subtext: fail ? 'Two files remain in their original folder.' : undefined,
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
        icon: (props) => <Spinner {...props} class="size-4 motion-safe:animate-spin" />,
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
            <span class="text-xs text-ink-muted tabular-nums">{progress()} of 100 MB</span>
          </div>
        ),
        actions: [{
          label: 'Cancel',
          onClick: () => {
            cancel?.();
            preview.dismiss(id);
          },
        }],
      },
    });
    const advance = () => {
      const next = Math.min(100, progress() + 10);
      setProgress(next);
      if (next === 100) {
        preview.dismiss(id);
        preview.show({ toastType: ToastType.SUCCESS, message: 'Archive downloaded' });
        return;
      }
      cancel = preview.later(advance, 300);
    };
    cancel = preview.later(advance, 300);
  };
  return (
    <div class="flex w-full flex-col items-center gap-4">
      <div class="flex flex-wrap justify-center gap-2">
        <Button variant="secondary" onClick={() => simulateOperation(false)}>Loading to success</Button>
        <Button variant="secondary" onClick={() => simulateOperation(true)}>Loading to failure</Button>
        <Button variant="secondary" onClick={simulateDownload}>Download progress</Button>
        <Button variant="ghost" onClick={preview.clear}>Clear</Button>
      </div>
      <PreviewRegion preview={preview} label="Async previews" />
    </div>
  );
}
// #endregion

// #region demo:stack
function StackDemo() {
  const preview = createToastPreview();
  const replay = () => {
    preview.clear();
    preview.show({ toastType: ToastType.SUCCESS, message: 'Link copied', duration: 12000 });
    preview.later(() => preview.show({
      toastType: ToastType.ALERT,
      message: 'Check attachment access',
      subtext: 'Recipients need permission before they can open the file.',
      duration: 12000,
    }), 300);
    preview.later(() => preview.show({
      toastType: ToastType.FAILURE,
      message: 'Download failed',
      duration: 12000,
    }), 600);
    preview.later(() => preview.show({
      toastType: ToastType.SUCCESS,
      message: 'Queued notice',
      subtext: 'A fourth notice waits until a slot is available.',
      duration: 12000,
    }), 900);
  };
  return (
    <div class="flex w-full flex-col items-center gap-4">
      <div class="flex flex-wrap justify-center gap-2">
        <Button variant="secondary" onClick={replay}>Replay stack</Button>
        <Button variant="ghost" onClick={preview.clear}>Clear</Button>
      </div>
      <PreviewRegion preview={preview} label="Stack preview" stack />
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'Toast',
  category: 'Feedback',
  description:
    'Status badges, title-aligned content and actions, and compact mobile notices. These local previews use the app renderer without triggering real operations or publishing into the app notification regions.',
  import: "import { toast } from '@core/component/Toast/Toast';",
  demos: [
    { id: 'notifications', title: 'Statuses and close controls', render: StatusesDemo, fill: true },
    { id: 'actions', title: 'Undo, persistent prompts, and custom content', render: ActionsDemo, fill: true },
    { id: 'async', title: 'Loading and progress', render: AsyncDemo, fill: true },
    {
      id: 'stack',
      title: 'Desktop stack and queue',
      description: 'Hover or focus to expand this three-card queue and pause dismissal. The app uses a separate, single transient slot on phones.',
      render: StackDemo,
      fill: true,
    },
  ],
  guidelines: {
    do: [
      'Use a short title and put supporting details in subtext.',
      'Reserve persistent prompts for notices that need a response.',
      'Keep action labels short and retain meaningful content on mobile.',
      'Use the existing toast service so queueing, timing, and dismissal stay consistent.',
    ],
    dont: [
      'Use a toast for information that must remain in the page.',
      'Add custom surfaces, shadows, or animations in consumers.',
      'Hide the close button when a persistent notice has no other dismissal action.',
    ],
  },
});
