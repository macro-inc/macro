import { runCreateAction } from '@app/component/Launcher';
import { useHandleFileUpload } from '@app/util/handleFileUpload';
import { setAutomationComposerOpen } from '@block-automation/component';
import { useSettingsState } from '@core/constant/SettingsState';
import { openFilePicker } from '@core/util/upload';
import IconGear from '@icon/macro-gear.svg';
import WideFileMdIcon from '@icon/wide-file-md.svg';
import WideTaskIcon from '@icon/wide-task.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import RobotIcon from '@phosphor/robot.svg';
import UploadIcon from '@phosphor/upload.svg';
import { Dropdown, Layer, Tooltip } from '@ui';
import {
  type Component,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

type QuickAction = {
  label: string;
  icon: Component<any>;
  onClick: () => void;
  tooltip: string;
};

const pillClass =
  'border-none group relative flex min-h-8 items-center gap-1.5 min-w-0 ring ring-edge-muted ring-inset rounded-full px-3 py-1.5 text-left text-ink-extra-muted hover:bg-hover focus-visible:bg-active focus-visible:border-accent sm:min-h-0 sm:gap-1 sm:px-2 sm:py-1';

function QuickActionPill(props: {
  label: string;
  icon: Component<any>;
  onClick: () => void;
  animationDelay?: string;
  ref?: (el: HTMLButtonElement) => void;
}) {
  return (
    <button
      ref={props.ref}
      class={`${pillClass} dashboard-quick-action-item`}
      tabIndex={0}
      onClick={props.onClick}
      style={{ 'animation-delay': props.animationDelay }}
    >
      <div class="flex w-full items-center justify-between gap-2">
        <Dynamic component={props.icon} class="size-3 transition" />
        <span class="min-w-0 whitespace-nowrap text-xs font-medium">
          {props.label}
        </span>
      </div>
    </button>
  );
}

function MoreActionsDropdown(props: { actions: QuickAction[] }) {
  return (
    <Dropdown placement="bottom-end">
      <Dropdown.Trigger
        class={`${pillClass} dashboard-quick-action-item`}
        depth={2}
      >
        <div class="flex w-full items-center justify-between gap-2">
          <span class="min-w-0 whitespace-nowrap text-xs font-medium">
            More
          </span>
          <CaretDownIcon class="size-2 shrink-0" />
        </div>
      </Dropdown.Trigger>
      <Dropdown.Content>
        <Dropdown.Group>
          <For each={props.actions}>
            {(action) => (
              <Dropdown.Item onSelect={() => setTimeout(action.onClick)}>
                <span class="flex size-3.5 shrink-0 items-center justify-center text-ink-muted">
                  <Dynamic component={action.icon} class="size-3.5" />
                </span>
                <span class="flex-1 truncate text-ink-muted">
                  {action.label}
                </span>
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

export function QuickActionsSection() {
  const handleFileUpload = useHandleFileUpload();
  const { openSettings } = useSettingsState();

  const quickActions: QuickAction[] = [
    {
      label: 'New task',
      icon: WideTaskIcon,
      onClick: () => runCreateAction('task'),
      tooltip: 'Capture a new task or follow-up.',
    },
    {
      label: 'New doc',
      icon: WideFileMdIcon,
      onClick: () => runCreateAction('md'),
      tooltip: 'Start a blank document.',
    },
    {
      label: 'New automation',
      icon: RobotIcon,
      onClick: () => setAutomationComposerOpen(true, false),
      tooltip: 'Build an automation for recurring work.',
    },
    {
      label: 'Upload file',
      icon: UploadIcon,
      onClick: () => {
        openFilePicker({ multiple: true }, async (files) => {
          await handleFileUpload(files, false);
        });
      },
      tooltip: 'Upload files to add them to your workspace.',
    },
    {
      label: 'Settings',
      icon: IconGear,
      onClick: () => openSettings(),
      tooltip: 'Open settings to manage your workspace.',
    },
  ];
  let containerEl: HTMLElement | undefined;
  let moreMeasureEl: HTMLButtonElement | undefined;
  const actionMeasureEls: HTMLButtonElement[] = [];
  const [visibleCount, setVisibleCount] = createSignal(quickActions.length);

  const visibleActions = createMemo(() =>
    quickActions.slice(0, visibleCount())
  );
  const overflowActions = createMemo(() => quickActions.slice(visibleCount()));

  const updateVisibleActions = () => {
    if (!containerEl || !moreMeasureEl) return;

    const gap = 8;
    const containerWidth = containerEl.getBoundingClientRect().width;
    const actionWidths = quickActions.map((_, index) =>
      Math.ceil(actionMeasureEls[index]?.getBoundingClientRect().width ?? 0)
    );

    if (containerWidth === 0 || actionWidths.some((width) => width === 0)) {
      return;
    }

    const totalWidth =
      actionWidths.reduce((sum, width) => sum + width, 0) +
      gap * (quickActions.length - 1);

    if (totalWidth <= containerWidth) {
      setVisibleCount(quickActions.length);
      return;
    }

    const moreWidth = Math.ceil(moreMeasureEl.getBoundingClientRect().width);
    for (let count = quickActions.length - 1; count >= 0; count -= 1) {
      const width =
        actionWidths.slice(0, count).reduce((sum, item) => sum + item, 0) +
        moreWidth +
        gap * count;

      if (width <= containerWidth) {
        setVisibleCount(count);
        return;
      }
    }

    setVisibleCount(0);
  };

  onMount(() => {
    const resizeObserver = new ResizeObserver(() => updateVisibleActions());
    if (containerEl) resizeObserver.observe(containerEl);

    requestAnimationFrame(updateVisibleActions);
    onCleanup(() => resizeObserver.disconnect());
  });

  return (
    <section
      ref={containerEl}
      class="@container/quick-actions relative flex flex-nowrap items-center justify-center gap-2 w-full"
    >
      <style>{
        /*css*/ `
          @keyframes dashboard-quick-action-fade-up {
            from { opacity: 0; transform: translateY(6px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .dashboard-quick-action-item {
            animation: dashboard-quick-action-fade-up 220ms ease-out both;
          }
          @media (prefers-reduced-motion: reduce) {
            .dashboard-quick-action-item { animation: none; }
          }
        `
      }</style>
      <Layer depth={2}>
        <For each={visibleActions()}>
          {(action, index) => (
            <Tooltip label={action.tooltip} placement="top">
              <QuickActionPill
                label={action.label}
                icon={action.icon}
                animationDelay={`${index() * 50}ms`}
                onClick={action.onClick}
              />
            </Tooltip>
          )}
        </For>
        <Show when={overflowActions().length > 0}>
          <MoreActionsDropdown actions={overflowActions()} />
        </Show>
      </Layer>

      <div
        aria-hidden="true"
        class="pointer-events-none invisible absolute left-0 top-0 flex gap-2"
      >
        <For each={quickActions}>
          {(action, index) => (
            <QuickActionPill
              ref={(el) => {
                actionMeasureEls[index()] = el;
              }}
              label={action.label}
              icon={action.icon}
              onClick={() => {}}
            />
          )}
        </For>
        <button ref={moreMeasureEl} class={pillClass} tabIndex={-1}>
          <div class="flex w-full items-center justify-between gap-2">
            <span class="min-w-0 whitespace-nowrap text-xs font-medium">
              More
            </span>
            <CaretDownIcon class="size-2 shrink-0" />
          </div>
        </button>
      </div>
    </section>
  );
}
