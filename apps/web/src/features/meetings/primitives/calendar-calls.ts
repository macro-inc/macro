import { createSignal, onCleanup } from 'solid-js';
import type {
  CalendarCallsActions,
  CalendarCallsSource,
} from '../context/calendar-calls';
import { type CalendarCallItem, calendarCallUrl } from '../core/calendar-calls';

export function createCalendarCalls(
  source: CalendarCallsSource,
  actions: CalendarCallsActions
) {
  const [tab, setTab] = createSignal<'upcoming' | 'recent'>('recent');
  const [now, setNow] = createSignal(new Date());
  const timer = setInterval(() => setNow(new Date()), 30_000);
  onCleanup(() => clearInterval(timer));
  const live = () => source.items().filter((item) => item.group === 'live');
  const upcoming = () =>
    source.items().filter((item) => item.group === 'scheduled');
  const recent = () => source.items().filter((item) => item.group === 'recent');
  const links = () => source.items().filter((item) => item.group === 'instant');
  const [selectedId, setSelectedId] = createSignal<string>();
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [copiedUrl, setCopiedUrl] = createSignal<string>();
  const [resolvedLinks, setResolvedLinks] = createSignal<
    Record<string, string>
  >({});
  const [confirmRevokeId, setConfirmRevokeId] = createSignal<string>();
  const [editingId, setEditingId] = createSignal<string>();
  const [title, setTitle] = createSignal('');
  const selected = () =>
    source.items().find((item) => item.id === selectedId());
  const url = (item: CalendarCallItem) =>
    calendarCallUrl(item) ?? resolvedLinks()[item.id];
  const confirmRevoke = () =>
    Boolean(confirmRevokeId()) && confirmRevokeId() === selected()?.id;
  const editing = () => Boolean(editingId()) && editingId() === selected()?.id;
  const setConfirmRevoke = (confirm: boolean) =>
    setConfirmRevokeId(confirm ? selected()?.id : undefined);
  const select = (item: CalendarCallItem) => {
    setSelectedId(item.id);
    setDetailsOpen(true);
    setConfirmRevoke(false);
    setEditingId(undefined);
    setError(undefined);
    setCopiedUrl(undefined);
  };
  async function run(action: () => Promise<void>, message: string) {
    if (pending()) return;
    setPending(true);
    setError(undefined);
    try {
      await action();
    } catch {
      setError(message);
    } finally {
      setPending(false);
    }
  }
  return {
    tab,
    setTab,
    now,
    live,
    upcoming,
    recent,
    links,
    rows: () => (tab() === 'upcoming' ? upcoming() : recent()),
    selected,
    select,
    detailsOpen,
    back: () => setDetailsOpen(false),
    pending,
    error,
    copiedUrl,
    url,
    confirmRevoke,
    setConfirmRevoke,
    editing,
    title,
    setTitle,
    join: (item: CalendarCallItem) =>
      run(
        () => actions.join(item),
        'Could not open the call. Please try again.'
      ),
    share: async (item: CalendarCallItem) => {
      setError(undefined);
      try {
        const value = url(item) ?? (await actions.resolveLink?.(item));
        if (!value) {
          setError('Could not load the call link. Please try again.');
          return;
        }
        setResolvedLinks((links) => ({ ...links, [item.id]: value }));
        if (await actions.copy(value)) setCopiedUrl(value);
        else
          setError(
            'Could not copy. Select the call link and copy it manually.'
          );
      } catch {
        setError('Could not copy. Select the call link and copy it manually.');
      }
    },
    startEditing: () => {
      setTitle(selected()?.title ?? '');
      setEditingId(selected()?.id);
    },
    cancelEditing: () => setEditingId(undefined),
    save: () =>
      run(async () => {
        const id = selected()?.link?.id;
        if (!id || !editing() || !title().trim()) return;
        await actions.rename(id, title().trim());
        setEditingId(undefined);
      }, 'Could not update the call. Please try again.'),
    revoke: () =>
      run(async () => {
        const id = selected()?.link?.id;
        if (!id || !confirmRevoke()) return;
        await actions.revoke(id);
        setConfirmRevoke(false);
        setDetailsOpen(false);
      }, 'Could not revoke the call link. Please try again.'),
  };
}
