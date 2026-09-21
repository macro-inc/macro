import type {
  SplitContent,
  SplitHandle,
  SplitManager,
} from '@components/app/split-layout/layoutManager';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openAgentComposer } from './open-composer';

const focus = vi.hoisted(() => ({
  target: undefined as (() => HTMLElement | null | undefined) | undefined,
}));
vi.mock('@core/directive/focusInput', () => ({
  triggerFocusInput: (target: () => HTMLElement | null | undefined) => {
    focus.target = target;
    target()?.focus();
  },
}));

function layout(existing = false) {
  let content: SplitContent = { type: 'component', id: 'agents' };
  const replace = vi.fn(({ next }: { next: SplitContent }) => {
    content = next;
  });
  const split = {
    id: 'agents-split',
    content: () => content,
    replace,
  } as unknown as SplitHandle;
  const openWithSplit = vi.fn<SplitManager['openWithSplit']>((next) => {
    if (!existing) content = next;
    return split;
  });
  return { openWithSplit, replace, content: () => content };
}

function input(workspace: string, isNew = true) {
  const root =
    document.querySelector<HTMLElement>(
      `[data-agents-workspace="${workspace}"]`
    ) ?? document.createElement('div');
  root.dataset.agentsWorkspace = workspace;
  const page = document.createElement('div');
  if (isNew) page.className = 'newchat';
  const editor = document.createElement('div');
  editor.setAttribute('contenteditable', 'true');
  editor.tabIndex = 0;
  page.append(editor);
  root.append(page);
  document.body.append(root);
  return editor;
}

afterEach(() => {
  document.body.replaceChildren();
  focus.target = undefined;
});

describe('openAgentComposer', () => {
  it('opens Agents with split placement and focuses only its new-chat input', () => {
    const home = input('home');
    input('agents-split', false);
    const editor = input('agents-split');
    home.focus();
    const manager = layout();
    openAgentComposer(manager, true);
    expect(manager.openWithSplit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'component', id: 'agents' }),
      { referredFrom: 'launcher', preferNewSplit: true }
    );
    expect(manager.replace).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(editor);
  });

  it('issues a new composer request each time an existing Agents split is opened', () => {
    const manager = layout(true);
    openAgentComposer(manager);
    const first = manager.content().params;
    openAgentComposer(manager);
    expect(manager.content().params).not.toEqual(first);
    expect(manager.replace).toHaveBeenCalledTimes(2);
    expect(manager.replace).toHaveBeenLastCalledWith({
      next: expect.objectContaining({ id: 'agents' }),
      mergeHistory: true,
    });
  });

  it('can find the input after asynchronous navigation without touching another draft', () => {
    const home = input('home');
    home.textContent = 'Keep this draft';
    openAgentComposer(layout());
    expect(focus.target?.()).toBeUndefined();
    const editor = input('agents-split');
    expect(focus.target?.()).toBe(editor);
    expect(home.textContent).toBe('Keep this draft');
  });

  it('does not steal focus when navigation is intercepted', () => {
    openAgentComposer({ openWithSplit: () => undefined });
    expect(focus.target).toBeUndefined();
  });
});
