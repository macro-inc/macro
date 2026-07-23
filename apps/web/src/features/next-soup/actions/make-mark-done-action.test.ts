import type { SplitHandle } from '@components/app/split-layout/layoutManager';
import type { EntityData } from '@entity';
import type { NotificationSource } from '@notifications';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoupState } from '../create-soup-state';

const mocks = vi.hoisted(() => ({
  controller: {
    isControllerSplit: vi.fn(() => true),
  },
  mutateAsync: vi.fn(async () => {}),
  openEntityInSplitFromUnifiedList: vi.fn(async () => {}),
}));

vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => ({ handle: mocks.controller }),
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false }),
}));

vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_NEW_INBOX_FLAG: 'new-inbox',
  ENABLE_NEW_INBOX_OVERRIDE: undefined,
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: {
    dismiss: vi.fn(),
    failure: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@queries/undo', () => ({
  useUndoableMutation: () => ({
    mutateAsync: mocks.mutateAsync,
  }),
}));

vi.mock('@app/features/next-soup/utils', () => ({
  applyEntitiesDoneOptimistic: vi.fn(),
  executeMarkEntitiesDone: vi.fn(),
  executeMarkEntitiesUndone: vi.fn(),
  openEntityInSplitFromUnifiedList: mocks.openEntityInSplitFromUnifiedList,
  resolveMarkEntitiesDoneVariables: () => ({
    emailIds: [],
    notificationIds: [],
  }),
  restoreSoupFocus: vi.fn(),
}));

import { makeMarkDoneAction } from './make-mark-done-action';

const currentEntity = {
  type: 'email',
  id: 'current',
} as EntityData;
const nextEntity = {
  type: 'email',
  id: 'next',
} as EntityData;

function createSoup() {
  const focusSet = vi.fn();
  const nextRow = { id: 'next-row', original: nextEntity };
  const soup = {
    focus: {
      id: () => 'current-row',
      set: focusSet,
    },
    selection: {
      clear: vi.fn(),
    },
    items: {
      count: () => 2,
      get: vi.fn(),
    },
    navigate: {
      peekOffset: vi.fn(() => ({ index: 1, row: nextRow })),
    },
    collapseEntity: {
      shouldCollapse: () => false,
      callback: vi.fn(),
    },
  } as unknown as SoupState;
  return { soup, focusSet };
}

function createAction() {
  return createRoot((dispose) => ({
    action: makeMarkDoneAction({
      notificationSource: () => ({}) as NotificationSource,
    }),
    dispose,
  }));
}

describe('makeMarkDoneAction', () => {
  beforeEach(() => {
    mocks.controller.isControllerSplit.mockReturnValue(true);
    mocks.mutateAsync.mockClear();
    mocks.openEntityInSplitFromUnifiedList.mockClear();
  });

  it('opens the next focused entity in an engaged Preview Controller', async () => {
    const { soup, focusSet } = createSoup();
    const { action, dispose } = createAction();

    await action.executeWithSoup([currentEntity], soup);

    expect(focusSet).toHaveBeenCalledWith('next-row');
    expect(mocks.openEntityInSplitFromUnifiedList).toHaveBeenCalledWith(
      nextEntity,
      {
        splitHandle: mocks.controller as unknown as SplitHandle,
        mergeHistory: true,
      }
    );
    dispose();
  });

  it('does not open the next entity when the split is not a Controller', async () => {
    mocks.controller.isControllerSplit.mockReturnValue(false);
    const { soup } = createSoup();
    const { action, dispose } = createAction();

    await action.executeWithSoup([currentEntity], soup);

    expect(mocks.openEntityInSplitFromUnifiedList).not.toHaveBeenCalled();
    dispose();
  });
});
