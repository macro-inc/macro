import {
  NavigationStack,
  useNavigationStack,
} from '@app/components/navigation-stack/NavigationStack';
import { toast } from '@core/component/Toast/Toast';
import { render } from '@solidjs/testing-library';
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  type ParentProps,
} from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { createPreviewSelectionGuard } from './createPreviewSelectionGuard';
import type { PreviewPanelSelection } from './previewTarget';
import { createContentInstanceRegistry } from './split-layout/contentInstanceRegistry';
import { SplitLayoutContext } from './split-layout/context';
import type { SplitManager } from './split-layout/layoutManager';

let manager: Pick<SplitManager, 'findOpenView' | 'registerOpenViews'>;
const activate = vi.hoisted(() => vi.fn());
vi.mock('@core/component/Toast/Toast', () => ({ toast: { alert: vi.fn() } }));
vi.mock('./split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ handle: { activate } }),
}));
vi.mock('@core/constant/allBlocks', () => ({
  resolveBlockAlias: (type: string) => (type === 'task' ? 'md' : type),
}));
vi.mock('./previewTarget', () => ({
  previewBlockTarget: (entity: PreviewPanelSelection) => ({
    blockType: entity.type === 'document' ? entity.fileType : entity.type,
    blockId: entity.id,
  }),
}));

beforeEach(() => {
  const registry = createContentInstanceRegistry();
  manager = {
    findOpenView: registry.find,
    registerOpenViews: registry.register,
  };
  vi.mocked(toast.alert).mockClear();
  activate.mockClear();
});

it('activates the split owning a preview and stops exposing it after close', () => {
  const view = setup();
  const channel = { type: 'channel', id: 'channel' } as const;
  view.stack.reset(channel);

  const existing = manager.findOpenView(channel);
  expect(existing).toBeDefined();
  existing?.activate?.();
  expect(activate).toHaveBeenCalledOnce();
  expect(view.stack.active()?.data).toEqual(channel);
  expect(toast.alert).not.toHaveBeenCalled();

  view.stack.clear();
  expect(manager.findOpenView(channel)).toBeUndefined();
  view.stack.reset(channel);
  view.unmount();
  expect(manager.findOpenView(channel)).toBeUndefined();
  expect(activate).toHaveBeenCalledOnce();
});

it('reactively exposes preview claims, releases, and unmounts', () => {
  createRoot((dispose) => {
    const channel = { type: 'channel', id: 'channel' } as const;
    const existing = createMemo(() => manager.findOpenView(channel));
    expect(existing()).toBeUndefined();
    const view = setup();
    view.stack.reset(channel);
    expect(existing()).toBeDefined();
    view.stack.clear();
    expect(existing()).toBeUndefined();
    view.stack.reset(channel);
    expect(existing()).toBeDefined();
    view.unmount();
    expect(existing()).toBeUndefined();
    dispose();
  });
});

function Layout(props: ParentProps) {
  return (
    <SplitLayoutContext.Provider value={{ manager: manager as SplitManager }}>
      {props.children}
    </SplitLayoutContext.Provider>
  );
}

function setup(defaultValue?: PreviewPanelSelection[]) {
  let stack!: ReturnType<typeof useNavigationStack<PreviewPanelSelection>>;
  let selectionGuard!: ReturnType<typeof createPreviewSelectionGuard>;
  function Capture() {
    stack = useNavigationStack<PreviewPanelSelection>();
    return null;
  }
  function App() {
    selectionGuard = createPreviewSelectionGuard();
    return (
      <NavigationStack.Root<PreviewPanelSelection>
        defaultValue={defaultValue}
        beforeChange={selectionGuard}
      >
        <Capture />
      </NavigationStack.Root>
    );
  }
  const view = render(() => (
    <Layout>
      <App />
    </Layout>
  ));
  return { stack, selectionGuard, ...view };
}

it('does not move focus or toast for a conflicting restored selection', () => {
  const channel = { type: 'channel', id: 'channel' } as const;
  const first = setup([channel]);
  const restored = setup([channel]);
  expect(restored.stack.active()).toBeUndefined();
  expect(activate).not.toHaveBeenCalled();
  expect(toast.alert).not.toHaveBeenCalled();

  restored.stack.reset(channel);
  expect(activate).toHaveBeenCalledOnce();
  expect(toast.alert).toHaveBeenCalledWith('Content already open');
  restored.unmount();
  first.unmount();
});

it('uses the change reason independently of mount timing', () => {
  const channel = { type: 'channel', id: 'channel' } as const;
  const first = setup([channel]);
  let selectPreview!: ReturnType<typeof createPreviewSelectionGuard>;
  function NavigateBeforeMount() {
    selectPreview = createPreviewSelectionGuard();
    // Navigation requested before mount still activates the existing view.
    expect(selectPreview(channel, 'navigate')).toBe(false);
    return null;
  }
  const second = render(() => (
    <Layout>
      <NavigateBeforeMount />
    </Layout>
  ));
  expect(activate).toHaveBeenCalledOnce();
  expect(toast.alert).toHaveBeenCalledWith('Content already open');

  activate.mockClear();
  vi.mocked(toast.alert).mockClear();
  // Restoring after mount must remain passive.
  expect(selectPreview(channel, 'restore')).toBe(false);
  expect(activate).not.toHaveBeenCalled();
  expect(toast.alert).not.toHaveBeenCalled();
  second.unmount();
  first.unmount();
});

it('rejects a second detail selection without changing its current entry and releases on close', () => {
  const first = setup();
  const second = setup();
  first.stack.reset({ type: 'email', id: 'one' });
  second.stack.reset({ type: 'email', id: 'two' });
  const current = second.stack.active();
  expect(second.stack.reset({ type: 'email', id: 'one' })).toBeUndefined();
  expect(second.stack.active()).toBe(current);
  expect(activate).toHaveBeenCalledOnce();
  expect(toast.alert).toHaveBeenCalledWith('Content already open');
  first.stack.clear();
  expect(second.stack.reset({ type: 'email', id: 'one' })).toBeDefined();
  first.unmount();
  second.unmount();
});

it('blocks breadcrumbs back to content opened elsewhere without changing history', () => {
  const first = setup();
  const second = setup();
  first.stack.push({ type: 'email', id: 'one' });
  first.stack.push({ type: 'email', id: 'two' });
  second.stack.reset({ type: 'email', id: 'one' });
  first.stack.pop();
  expect(first.stack.active()?.data.id).toBe('two');
  expect(first.stack.entries).toHaveLength(2);
  second.unmount();
  first.stack.pop();
  expect(first.stack.active()?.data.id).toBe('one');
  first.unmount();
});

it('does not subscribe a calling effect to its internal claim', () => {
  let setSelection!: (selection: PreviewPanelSelection | undefined) => void;
  let runs = 0;

  function App() {
    const selectPreview = createPreviewSelectionGuard();
    const [selection, set] = createSignal<PreviewPanelSelection>();
    setSelection = set;
    createEffect(() => {
      runs += 1;
      selectPreview(selection());
    });
    return null;
  }

  const view = render(() => (
    <Layout>
      <App />
    </Layout>
  ));
  expect(runs).toBe(1);

  const channel = { type: 'channel', id: 'channel' } as const;
  setSelection(channel);
  expect(runs).toBe(2);
  expect(manager.findOpenView(channel)).toBeDefined();
  view.unmount();
});

it('preflights without claiming the requested selection', () => {
  const first = setup();
  const second = setup();
  const third = setup();
  const one = { type: 'email', id: 'one' } as const;
  const two = { type: 'email', id: 'two' } as const;

  first.stack.reset(one);
  expect(second.selectionGuard.canSelect(one)).toBe(false);
  expect(second.selectionGuard.canSelect(two)).toBe(true);
  expect(third.stack.reset(two)).toBeDefined();

  first.unmount();
  second.unmount();
  third.unmount();
});

it('treats Markdown as single-instance and allows revisiting the owning preview', () => {
  const first = setup();
  const second = setup();
  const document = { type: 'document', fileType: 'md', id: 'doc' } as const;
  expect(first.stack.reset(document)).toBeDefined();
  expect(second.stack.reset(document)).toBeUndefined();
  expect(toast.alert).toHaveBeenCalledWith('Content already open');
  expect(first.stack.reset(document)).toBeDefined();
  first.unmount();
  second.unmount();
});
