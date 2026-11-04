import type { EntityData } from '@entity';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  copyTaskBranch: vi.fn(async () => {}),
  success: vi.fn(),
}));
vi.mock('@core/util/branchName', () => ({
  copyBranchNameToClipboard: mocks.copyTaskBranch,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.success, failure: vi.fn() },
}));

import { makeCopyBranchNameAction } from './make-copy-branch-name-action';

const pullRequest = (headBranch?: string) =>
  ({
    type: 'foreign',
    foreignSource: 'github_pull_request',
    id: 'pr-1',
    name: 'Fix reply state',
    ownerId: '',
    metadata: { url: 'https://github.com/o/r/pull/1', headBranch },
  }) as unknown as EntityData;

const task = {
  type: 'document',
  fileType: 'md',
  subType: { type: 'task', is_completed: false },
  id: 'task-1',
  name: 'Task',
  ownerId: '',
} as EntityData;

const writeText = vi.fn(async () => {});
Object.assign(navigator, { clipboard: { writeText } });

afterEach(() => vi.clearAllMocks());

describe('makeCopyBranchNameAction', () => {
  const action = makeCopyBranchNameAction();

  it("copies a pull request's head branch", async () => {
    expect(action.canExecute(pullRequest('fix/reply-state'))).toBe(true);
    await action.execute([pullRequest('fix/reply-state')]);
    expect(writeText).toHaveBeenCalledWith('fix/reply-state');
    expect(mocks.copyTaskBranch).not.toHaveBeenCalled();
  });

  it('skips a pull request whose branch was not stored', () => {
    expect(action.canExecute(pullRequest())).toBe(false);
  });

  it("still copies a task's derived branch name", async () => {
    expect(action.canExecute(task)).toBe(true);
    await action.execute([task]);
    expect(mocks.copyTaskBranch).toHaveBeenCalledWith('task-1');
  });
});
