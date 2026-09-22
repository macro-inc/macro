import {
  NavigationStack,
  useNavigationStack,
} from '@app/components/navigation-stack/NavigationStack';
import { toast } from '@core/component/Toast/Toast';
import { createContentInstanceRegistry } from '@core/contentInstanceRegistry';
import { render } from '@solidjs/testing-library';
import { beforeEach, expect, it, vi } from 'vitest';
import { createPreviewSelectionGuard } from './createPreviewSelectionGuard';
import type { PreviewPanelSelection } from './previewTarget';

const app = vi.hoisted(() => ({ orchestrator: {} as Record<string, unknown> }));
vi.mock('./GlobalAppState', () => ({
  useGlobalBlockOrchestrator: () => app.orchestrator,
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: { alert: vi.fn() } }));
vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToResolvedBlockName: (type: string) => type,
  resolveBlockAlias: (type: string) => (type === 'task' ? 'md' : type),
}));
vi.mock('@app/features/next-soup/utils', () => ({
  calendarBlockParamsForEntity: vi.fn(),
  getChannelEntityTarget: vi.fn(),
}));
vi.mock('@block-calendar/types', () => ({ CALENDAR_BLOCK_ID: 'calendar' }));
vi.mock('@block-channel/utils/link', () => ({ getChannelParams: vi.fn() }));
vi.mock('@core/constant/featureFlags', () => ({
  USE_MACRO_PR_SUMMARY_BLOCK: false,
}));

beforeEach(() => {
  app.orchestrator = { contentInstances: createContentInstanceRegistry() };
  vi.mocked(toast.alert).mockClear();
});

function setup() {
  let stack!: ReturnType<typeof useNavigationStack<PreviewPanelSelection>>;
  function Capture() {
    stack = useNavigationStack<PreviewPanelSelection>();
    return null;
  }
  function App() {
    const guard = createPreviewSelectionGuard();
    return (
      <NavigationStack.Root<PreviewPanelSelection> beforeChange={guard}>
        <Capture />
      </NavigationStack.Root>
    );
  }
  const view = render(App);
  return { stack, ...view };
}

it('rejects a second detail selection without changing its current entry and releases on close', () => {
  const first = setup();
  const second = setup();
  first.stack.reset({ type: 'email', id: 'one' });
  second.stack.reset({ type: 'email', id: 'two' });
  const current = second.stack.active();
  expect(second.stack.reset({ type: 'email', id: 'one' })).toBeUndefined();
  expect(second.stack.active()).toBe(current);
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

it('uses the real reminder target to block the same detail in a split or preview', () => {
  const registry = (
    app.orchestrator as {
      contentInstances: ReturnType<typeof createContentInstanceRegistry>;
    }
  ).contentInstances;
  const releaseSplit = registry.register(() => [
    {
      owner: 'reminder-split',
      content: { type: 'component', id: 'reminder-view~one' },
    },
  ]);
  const first = setup();
  const reminder = { type: 'reminder', id: 'one' } as const;

  expect(first.stack.reset(reminder)).toBeUndefined();
  expect(toast.alert).toHaveBeenCalledWith('Content already open');

  releaseSplit();
  expect(first.stack.reset(reminder)).toBeDefined();
  const second = setup();
  expect(second.stack.reset(reminder)).toBeUndefined();
  expect(second.stack.reset({ type: 'reminder', id: 'two' })).toBeDefined();

  first.unmount();
  second.unmount();
});
