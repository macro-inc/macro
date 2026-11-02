import { toast } from '@core/component/Toast/Toast';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { buildSimpleEntityUrl } from '@core/util/url';
import ArrowSquareOutIcon from '@icon/system/regular/arrow-square-out.svg';
import SplitIcon from '@icon/system/regular/square-half.svg';
import type { TaskComposerHost } from './task-composer';

export function showTaskCreatedToast(
  documentId: string,
  optimisticSnapshot: Uint8Array | undefined,
  openTask: TaskComposerHost['openTask']
) {
  const task = { id: documentId, optimisticSnapshot };
  const open = (newSplit: boolean) => {
    if (toastId !== undefined) toast.dismiss(toastId);
    openTask(task, { newSplit, referredFrom: null });
  };
  const toastId = toast.success('Task created', {
    actions: [
      {
        label: 'Open',
        icon: ArrowSquareOutIcon,
        onClick: () => open(false),
      },
      ...(!isTouchDevice()
        ? [
            {
              label: 'Open (New Split)',
              icon: SplitIcon,
              onClick: () => open(true),
            },
          ]
        : []),
    ],
  });

  // The write needs the click's user activation, which can lapse while the
  // server creates the task. The browser then denies it or holds it behind a
  // permission prompt, and the toast must not wait on either.
  fireAndForget(copyTaskLink(documentId), 'compose-task');
}

async function copyTaskLink(documentId: string) {
  try {
    await navigator.clipboard.writeText(
      buildSimpleEntityUrl({ type: 'task', id: documentId })
    );
  } catch {
    // A denied write is expected, and the toast already confirmed the task.
  }
}
