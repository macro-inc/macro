import { toast } from '@core/component/Toast/Toast';
import { dismissPromptEverywhere } from '@queries/prompt-dismissals';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarRoutineSuggestions } from './routine-suggestions';
import { drafted, forYou, TAGS, template } from './tests/fixtures';

const device = vi.hoisted(() => ({ touch: false }));

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => device.touch,
}));
vi.mock('@app/lib/analytics', () => ({ analytics: { track: vi.fn() } }));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@app/features/agents-view/primitives/open-page', () => ({
  openAgentsPage: vi.fn(),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({}),
}));
vi.mock('@core/auth/license', () => ({ useHasPaidAccess: () => () => true }));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'alice' }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(() => 7), dismiss: vi.fn(), alert: vi.fn() },
}));
vi.mock('@queries/prompt-dismissals', () => ({
  usePromptDismissalsQuery: () => ({
    isSuccess: true,
    isError: false,
    data: { dismissed: [] },
  }),
  dismissPromptEverywhere: vi.fn(),
}));
vi.mock('@queries/properties/tags', () => ({
  useEnsureTagSetMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('./queries/routine-suggestions', () => ({
  useRoutineSuggestionsEnabled: () => () => true,
  useRoutineSuggestions: () => ({
    suggestions: () => [forYou, template, drafted],
    generating: () => false,
    failed: () => false,
    retry: vi.fn(),
  }),
  useDismissRoutineSuggestionMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../routines/queries/catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../routines/queries/catalog')>()),
  useLoadedRoutineCatalog: () => () => [TAGS],
}));
vi.mock('../routines/queries/schedules', () => ({
  useCreateScheduleMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock(
  '@property/identifiers',
  async () => await vi.importActual('@property/identifiers')
);
vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: () => 'New routine',
}));

type ToastOptions = {
  subtext?: string;
  actions?: { label: string; onClick(): void }[];
  onDismiss?: () => void;
};

/** The options of the toast the last hide showed. */
function lastToast() {
  const call = vi.mocked(toast.success).mock.lastCall as
    | [string, ToastOptions]
    | undefined;
  if (!call) throw new Error('expected a toast');
  return { title: call[0], ...call[1] };
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  device.touch = false;
  vi.mocked(toast.success).mockClear();
  vi.mocked(dismissPromptEverywhere).mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('the sidebar suggestions card', () => {
  it('says how many routines it has for the surface and names them', () => {
    render(() => <SidebarRoutineSuggestions surface="email" />);
    expect(
      screen.getByRole('button', { name: /2 routines for you/ })
    ).toBeTruthy();
  });

  it('hides for the surface with a toast, and Undo brings it back without telling the server', async () => {
    render(() => <SidebarRoutineSuggestions surface="email" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Hide suggestions in Email' })
    );
    await waitFor(() =>
      expect(screen.queryByText(/routines for you/)).toBeNull()
    );
    const shown = lastToast();
    expect(shown.title).toBe('Routine suggestions hidden in Email');
    expect(shown.subtext).toBe('Find them any time in Routines › Discover.');
    const [undo] = shown.actions ?? [];
    expect(undo?.label).toBe('Undo');
    undo?.onClick();
    // Closing the toast after Undo dismisses nothing.
    shown.onDismiss?.();
    expect(await screen.findByText(/2 routines for you/)).toBeTruthy();
    expect(dismissPromptEverywhere).not.toHaveBeenCalled();
    expect(toast.dismiss).toHaveBeenCalledWith(7);
  });

  it('dismisses on every device once the toast closes without Undo', async () => {
    render(() => <SidebarRoutineSuggestions surface="email" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Hide suggestions in Email' })
    );
    lastToast().onDismiss?.();
    expect(dismissPromptEverywhere).toHaveBeenCalledExactlyOnceWith(
      'routine-suggestions:email'
    );
    await waitFor(() =>
      expect(screen.queryByText(/routines for you/)).toBeNull()
    );
  });

  it('never shows on touch', () => {
    device.touch = true;
    render(() => <SidebarRoutineSuggestions surface="email" />);
    expect(screen.queryByText(/routines for you/)).toBeNull();
  });
});
