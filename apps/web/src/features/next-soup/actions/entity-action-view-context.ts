import { isListViewID } from '@app/constants/list-views';
import { canExecuteMarkDoneOnView } from './make-mark-done-action';

export type EntityActionSenderBucket = 'signal' | 'noise';

export type EntityActionViewContext = {
  supportsMarkDone: boolean;
  senderBucket: EntityActionSenderBucket | undefined;
};

function resolveSenderBucket(
  activeTab: string | undefined
): EntityActionSenderBucket | undefined {
  if (activeTab === 'noise') return 'noise';

  if (
    activeTab === undefined ||
    activeTab === 'signal' ||
    activeTab === 'important'
  ) {
    return 'signal';
  }

  return undefined;
}

export function resolveEntityActionViewContext(options: {
  activeListView: string;
  activeTab: string | undefined;
}): EntityActionViewContext {
  const { activeListView, activeTab } = options;

  return {
    supportsMarkDone:
      activeTab !== undefined &&
      isListViewID(activeListView) &&
      canExecuteMarkDoneOnView(activeListView, activeTab),
    senderBucket: resolveSenderBucket(activeTab),
  };
}
