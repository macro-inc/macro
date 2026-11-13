import { describe, expect, it, vi } from 'vitest';
import type { SplitContent, SplitId } from '../layoutManager';
import { createMobileBackNavigation } from '../mobile/createMobileBackNavigation';

const FRONT = 'front' as SplitId;
const BEHIND = 'behind' as SplitId;
const PROJECT = '00000000-0000-4000-8000-000000000001';

function projectContent(section: string, projectId = PROJECT): SplitContent {
  return {
    type: 'initiative',
    id: projectId,
    entryMetadata: {
      route: {
        matches: [
          { id: 'view-tasks', params: {} },
          { id: 'tasks-project', params: { projectId, section } },
        ],
      },
    },
  };
}

function setup(
  options: {
    phone?: boolean;
    stackBack?: boolean;
    current?: SplitContent;
    previous?: SplitContent | null;
    rawBack?: boolean;
  } = {}
) {
  let front: SplitId | undefined = FRONT;
  const routeBack = vi.fn();
  const stackBack = vi.fn();
  const back = createMobileBackNavigation({
    phone: () => options.phone ?? true,
    getSplit: () => ({
      content: () => options.current ?? projectContent('tasks'),
      previousContent: () =>
        options.previous === undefined
          ? projectContent('overview')
          : options.previous,
      canGoBack: () => options.rawBack ?? true,
      goBack: routeBack,
    }),
    stack: {
      front: () => front,
      behind: () => BEHIND,
      canGoBack: () => options.stackBack ?? true,
      goBack: stackBack,
      completeGoBack: () => {},
      setAnimatedTrigger: () => {},
      setForwardTrigger: () => {},
    },
  });
  return {
    back,
    routeBack,
    stackBack,
    setFront: (id: SplitId) => {
      front = id;
    },
  };
}

describe('native phone project Back', () => {
  it.each([true, false])(
    'returns to Overview before closing a pane (stack available: %s)',
    (stackBack) => {
      const test = setup({ stackBack });
      expect(test.back.canGoBack()).toBe(true);
      test.back.goBack();
      expect(test.routeBack).toHaveBeenCalledOnce();
      expect(test.stackBack).not.toHaveBeenCalled();
    }
  );

  it('uses the same back operation for the caret and hardware Back', () => {
    const test = setup();
    test.back.goBack(FRONT);
    test.back.goBack();
    expect(test.routeBack).toHaveBeenCalledTimes(2);
    expect(test.stackBack).not.toHaveBeenCalled();
  });

  it.each([
    { phone: false },
    { rawBack: false },
    { previous: null },
    {
      previous: projectContent(
        'overview',
        '00000000-0000-4000-8000-000000000002'
      ),
    },
    { previous: projectContent('tasks') },
    { current: projectContent('overview') },
    { current: { type: 'initiative', id: PROJECT } satisfies SplitContent },
    {
      current: {
        type: 'initiative',
        id: PROJECT,
        entryMetadata: {
          route: {
            matches: [
              {
                id: 'tasks-project-task',
                params: {
                  projectId: PROJECT,
                  section: 'tasks',
                  taskId: 'task',
                },
              },
            ],
          },
        },
      } satisfies SplitContent,
    },
  ])('keeps pane-stack behavior for %o', (options) => {
    const test = setup(options);
    test.back.goBack();
    expect(test.stackBack).toHaveBeenCalledOnce();
    expect(test.routeBack).not.toHaveBeenCalled();
  });

  it('does not expose or run Back for a covered pane', () => {
    const test = setup();
    expect(test.back.canGoBack(BEHIND)).toBe(false);
    test.back.goBack(BEHIND);
    test.setFront(BEHIND);
    test.back.goBack(FRONT);
    expect(test.routeBack).not.toHaveBeenCalled();
    expect(test.stackBack).not.toHaveBeenCalled();
  });

  it('retains root availability when no route or pane can go back', () => {
    const test = setup({ previous: null, stackBack: false });
    expect(test.back.canGoBack()).toBe(false);
  });
});
