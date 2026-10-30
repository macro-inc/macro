import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Show } from 'solid-js';
import type { ComposeTaskProps } from './core/types';
import {
  createTaskComposer,
  type TaskComposerHost,
} from './primitives/task-composer';
import { DesktopTaskComposer } from './views/desktop-task-composer';
import { MobileTaskComposer } from './views/mobile-task-composer';

function createSplitTaskComposerHost(): TaskComposerHost {
  const splitPanel = useSplitPanelOrThrow();
  const { popoverSplit, openWithSplit } = useSplitLayout();
  const taskContent = (task: {
    id: string;
    optimisticSnapshot?: Uint8Array;
  }) => {
    const snapshotParams = task.optimisticSnapshot
      ? {
          params: { optimisticSnapshot: task.optimisticSnapshot },
          preserveParams: true as const,
        }
      : {};
    return { type: 'task' as const, id: task.id, ...snapshotParams };
  };
  return {
    userId: useUserId(),
    resolveAppLink: useMacroMentionLinkResolver(),
    isPopover: () => splitPanel.handle.isPopover(),
    setDisplayName: (name) => splitPanel.handle.setDisplayName(name),
    close: () => splitPanel.handle.close(),
    openComposer: (params) =>
      popoverSplit({ type: 'component', id: 'task-compose', params }),
    openTask: (task, options) =>
      openWithSplit(taskContent(task), {
        referredFrom: options.referredFrom,
        preferNewSplit: options.newSplit,
      }),
    openPendingTask: () => {
      const { split } = openWithSplit(
        { type: 'component', id: 'loading' },
        { referredFrom: 'launcher', preferNewSplit: true }
      );
      return {
        show: (task) =>
          split?.replace({
            next: taskContent(task),
            mergeHistory: true,
            referredFrom: 'launcher',
          }),
        cancel: () => split?.goBack(),
      };
    },
  };
}

/** Touch devices show a popover split in a bottom sheet, with its own layout. */
export function ComposeTask(props: ComposeTaskProps) {
  const composer = createTaskComposer(props, createSplitTaskComposerHost());
  return (
    <Show
      when={isTouchDevice() && composer.isPopover()}
      fallback={<DesktopTaskComposer composer={composer} />}
    >
      <MobileTaskComposer composer={composer} />
    </Show>
  );
}
