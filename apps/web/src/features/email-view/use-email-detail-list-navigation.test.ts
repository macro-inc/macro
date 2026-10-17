import type { EmailEntity } from '@entity';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailDetailListNavigation } from './use-email-detail-list-navigation';

const mocks = vi.hoisted(() => ({
  view: vi.fn(),
  open: vi.fn(),
  failure: vi.fn(),
  loadMore: vi.fn(),
}));
vi.mock('./email-view-context', () => ({ useEmailView: mocks.view }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
vi.mock(
  '@app/components/list',
  async () => await import('@app/components/list/use-list-detail-navigation')
);
const disposals: (() => void)[] = [];
beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
});
function setup(ids: string[], current = 'b') {
  const [rows, setRows] = createSignal(ids);
  const [threadId, setThreadId] = createSignal(current);
  const [hasMore, setHasMore] = createSignal(false);
  mocks.view.mockReturnValue({
    source: {
      items: () =>
        rows().map((id) => ({
          kind: 'entity',
          entity: { type: 'email', id, name: id } as EmailEntity,
        })),
      hasMore,
      loadMore: mocks.loadMore,
      error: () => undefined,
    },
    openThread: mocks.open,
  });
  const navigation = createRoot((dispose) => {
    disposals.push(dispose);
    return useEmailDetailListNavigation(threadId);
  });
  return { navigation, setRows, setHasMore, setThreadId };
}
describe('thread navigation after the open thread leaves the list', () => {
  it('keeps next and previous on its former neighbours', async () => {
    const { navigation, setRows } = setup(['a', 'b', 'c']);
    // Replying in Signal marks the thread done, which removes its row.
    setRows(['a', 'c']);
    expect(navigation.canNext()).toBe(true);
    expect(navigation.canPrevious()).toBe(true);
    await navigation.navigate(1);
    expect(mocks.open).toHaveBeenLastCalledWith({ id: 'c', fallbackName: 'c' });
    await navigation.navigate(-1);
    expect(mocks.open).toHaveBeenLastCalledWith({ id: 'a', fallbackName: 'a' });
  });
  it('has no previous when the removed thread was first', () => {
    const { navigation, setRows } = setup(['a', 'b', 'c'], 'a');
    setRows(['b', 'c']);
    expect(navigation.canPrevious()).toBe(false);
    expect(navigation.canNext()).toBe(true);
  });
});
describe('email reminder navigation', () => {
  it('advances after the server event removes the saved row', async () => {
    const { navigation, setRows } = setup(['a', 'b', 'c']);
    setRows(['a', 'c']);
    await navigation.afterReminderSaved?.();
    expect(mocks.open).toHaveBeenCalledWith({ id: 'c', fallbackName: 'c' });
  });
  it('skips neighbors that no longer belong to the live filtered list', async () => {
    const { navigation, setRows } = setup(['a', 'b', 'c', 'd']);
    setRows(['a', 'd']);
    await navigation.afterReminderSaved?.();
    expect(mocks.open).toHaveBeenCalledWith({ id: 'd', fallbackName: 'd' });
  });
  it('falls back to a surviving previous email', async () => {
    const { navigation, setRows } = setup(['a', 'b', 'c']);
    setRows(['a']);
    await navigation.afterReminderSaved?.();
    expect(mocks.open).toHaveBeenCalledWith({ id: 'a', fallbackName: 'a' });
  });
  it('loads the next page before falling back when the removed email was last', async () => {
    const { navigation, setRows, setHasMore } = setup(['a', 'b']);
    setHasMore(true);
    setRows(['a']);
    mocks.loadMore.mockImplementation(async () => {
      setRows(['a', 'c']);
      setHasMore(false);
    });
    await navigation.afterReminderSaved?.();
    expect(mocks.loadMore).toHaveBeenCalledOnce();
    expect(mocks.open).toHaveBeenCalledWith({ id: 'c', fallbackName: 'c' });
  });
  it('does not navigate after the detail changes during pagination', async () => {
    const { navigation, setRows, setHasMore, setThreadId } = setup(['a', 'b']);
    setHasMore(true);
    setRows(['a']);
    mocks.loadMore.mockImplementation(async () => {
      setRows(['a', 'c']);
      setThreadId('other');
      setHasMore(false);
    });
    await navigation.afterReminderSaved?.();
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it('does not reopen a removed candidate when the list becomes empty', async () => {
    const { navigation, setRows } = setup(['a', 'b', 'c']);
    setRows([]);
    await navigation.afterReminderSaved?.();
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it('keeps the normal navigation path when the saved row remains in the source', async () => {
    const { navigation } = setup(['a', 'b', 'c']);
    await navigation.afterReminderSaved?.();
    expect(mocks.open).toHaveBeenCalledWith({ id: 'c', fallbackName: 'c' });
  });
});
