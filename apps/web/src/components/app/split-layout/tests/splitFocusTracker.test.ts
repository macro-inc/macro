import type { BlockOrchestrator } from '@core/orchestrator';
import { createRoot } from 'solid-js';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { SplitId } from '../layoutManager';
import { createSplitFocusTracker } from '../splitFocusTracker';
import { createRoutedSplitLayout } from './fixtures';

vi.mock('../componentRegistry', () => ({
  resolveComponent: vi.fn((id: string, params: Record<string, string>) => ({
    type: 'mock-component',
    id,
    params,
  })),
}));

vi.mock('@core/constant/allBlocks', () => ({
  isBlockAlias: vi.fn(() => false),
  resolveBlockAlias: vi.fn((type: string) => type),
}));

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    }),
  });
});

function createMockOrchestrator(): BlockOrchestrator {
  return {
    isBlockMounted: vi.fn(() => false),
    createBlockInstance: vi.fn((_type, id, _splitId) => ({
      node: { type: 'mock-node', id },
      detach: vi.fn(),
      dispose: vi.fn(),
    })),
  } as unknown as BlockOrchestrator;
}

function createPanel(): HTMLDivElement {
  const panel = document.createElement('div');
  panel.tabIndex = -1;
  document.body.appendChild(panel);
  return panel;
}

/** Covers the tracker's Insert focus, debounced by 40ms. */
const FOCUS_DEBOUNCE_MS = 50;

/**
 * Reproduce the fresh-load wiring of SplitLayoutContainer: the manager comes
 * up from URL contents (last split active), then the focus tracker mounts
 * and processes the trailing Insert event.
 */
function mountFreshLoad(url = '/home/~/channels') {
  return createRoot((dispose) => {
    const manager = createRoutedSplitLayout(createMockOrchestrator(), url);

    const panelRefs = new Map<SplitId, HTMLDivElement>(
      manager.splits().map((split) => [split.id, createPanel()])
    );

    createSplitFocusTracker({
      splitManager: manager,
      panelRefs,
      splits: manager.splits,
    });

    return { dispose, manager, panelRefs };
  });
}

describe('createSplitFocusTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('cancels pending debounced focus when its owner is disposed', () => {
    const { dispose } = mountFreshLoad();

    dispose();
    vi.advanceTimersByTime(FOCUS_DEBOUNCE_MS);

    expect(document.activeElement).toBe(document.body);
  });

  it('keeps fresh-load focus on the last split', () => {
    const { dispose, manager, panelRefs } = mountFreshLoad();
    const [, last] = manager.splits();

    vi.advanceTimersByTime(FOCUS_DEBOUNCE_MS);

    expect(document.activeElement).toBe(panelRefs.get(last.id));
    expect(manager.activeSplitId()).toBe(last.id);

    dispose();
  });

  it('preserves a focused chrome input through deferred insertion but honors explicit return focus', () => {
    const { dispose, manager, panelRefs } = mountFreshLoad();
    const [, last] = manager.splits();
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    vi.advanceTimersByTime(FOCUS_DEBOUNCE_MS);

    expect(document.activeElement).toBe(input);
    expect(manager.activeSplitId()).toBe(last.id);
    manager.returnFocus();
    expect(document.activeElement).toBe(panelRefs.get(last.id));
    dispose();
  });

  it('still focuses a new pane when the previous pane owns an editor', () => {
    const { dispose, manager, panelRefs } = mountFreshLoad();
    const [first, last] = manager.splits();
    const input = document.createElement('input');
    panelRefs.get(first.id)?.append(input);
    input.focus();

    vi.advanceTimersByTime(FOCUS_DEBOUNCE_MS);

    expect(document.activeElement).toBe(panelRefs.get(last.id));
    dispose();
  });

  it('focuses a reused pane after its old content is replaced', async () => {
    const { dispose, manager, panelRefs } = mountFreshLoad('/home');
    const last = manager.splits().at(-1)!;
    const panel = panelRefs.get(last.id)!;
    const oldInput = document.createElement('input');
    panel.append(oldInput);
    oldInput.focus();

    manager.openWithSplit({ type: 'component', id: 'channels' });
    oldInput.remove();
    await vi.runAllTimersAsync();

    expect(document.activeElement).toBe(panel);
    dispose();
  });

  it('keeps focus claimed by the destination before the pane focus runs', async () => {
    const { dispose, manager, panelRefs } = mountFreshLoad('/home');
    const last = manager.splits().at(-1)!;
    const panel = panelRefs.get(last.id)!;

    manager.openWithSplit({ type: 'component', id: 'channels' });
    const editor = document.createElement('input');
    panel.append(editor);
    editor.focus();
    await vi.runAllTimersAsync();

    expect(document.activeElement).toBe(editor);
    dispose();
  });

  it('keeps a surviving pane active after removal without taking chrome focus', async () => {
    const { dispose, manager } = mountFreshLoad();
    const [first, last] = manager.splits();
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    manager.removeSplit(last.id);
    await vi.runAllTimersAsync();

    expect(manager.splits().map((split) => split.id)).toEqual([first.id]);
    expect(manager.activeSplitId()).toBe(first.id);
    expect(document.activeElement).toBe(input);
    dispose();
  });
});
