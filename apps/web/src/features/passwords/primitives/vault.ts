import { t } from '@app/lib/i18n';
import { makePersistedState } from '@app/lib/persistence';
import { fireAndForget } from '@core/util/fireAndForget';
import { catchToResult } from '@core/util/result';
import { type Span, Telemetry } from '@macro-inc/observability';
import { useQuery, useQueryClient } from '@tanstack/solid-query';
import { createSignal, onCleanup } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { v7 as uuidv7 } from 'uuid';
import {
  type PasswordFailure,
  usePasswords,
} from '../context/passwords-context';
import { KIND_LAYOUTS, PASSWORD_KINDS } from '../core/kinds';
import {
  filterItems,
  folderSubtree,
  type PasswordActivity,
  type PasswordDraft,
  type PasswordFilter,
  type PasswordGrant,
  type PasswordGroupBy,
  type PasswordItem,
  type PasswordKind,
  type PasswordValues,
  type PasswordVersion,
  validateDraft,
} from '../core/types';
import {
  createPasswordListViewStorage,
  defaultPasswordListView,
  type PasswordListView,
  type PasswordListViewEntry,
} from '../persistence';
import { passwordKeys } from '../queries/keys';
import { isServiceUnavailable, isUnreachable } from '../queries/source';

/**
 * An unsaved new item or an in-place edit of an existing one. Drafts live only
 * in this in-memory store: never in a query cache or browser storage.
 */
export type VaultDraft = {
  key: string;
  /** Set for edits, and for a new item once its first save succeeds. */
  itemId?: string;
  version?: number;
  draft: PasswordDraft;
  /** Verification-code seed to enroll after the item saves. */
  totpKey: string;
  validation?: 'name' | 'url' | 'totp';
  failure?: PasswordFailure | 'totp';
  busy: boolean;
};

/** Why the list on screen may be out of date. */
export type ConnectionProblem = Extract<
  PasswordFailure,
  'unreachable' | 'serviceUnavailable'
>;
export type VaultSelection =
  | { kind: 'item'; id: string }
  | { kind: 'draft'; key: string };

type DraftState = {
  drafts: Record<string, VaultDraft>;
  /** New-item drafts, newest first, as they appear at the top of the list. */
  order: string[];
};

type DraftBookkeeping = {
  operationId?: string;
  submitted?: PasswordDraft;
  /** Content the item already holds, so a seed retry skips a second write. */
  saved?: PasswordDraft;
};

const REVEAL_WINDOW_MS = 60_000;

const editKey = (itemId: string) => `edit:${itemId}`;

/** `entry` keeps the list's type filter and grouping with a split history entry. */
export function createVault(options: { entry?: PasswordListViewEntry } = {}) {
  const { scope, source, writeClipboard } = usePasswords();
  const queryClient = useQueryClient();
  const [favoritePending, setFavoritePending] = createSignal<
    ReadonlySet<string>
  >(new Set());
  /** False once the viewer's account or session changed under this vault. */
  const stale = () => !scope.isCurrent();
  const items = useQuery(() => ({
    queryKey: passwordKeys.items(scope.key).queryKey,
    queryFn: source.list,
    reconcile: 'id',
  }));
  const folders = useQuery(() => ({
    queryKey: passwordKeys.folders(scope.key).queryKey,
    queryFn: source.folders,
    reconcile: 'id',
  }));
  const loadedItems = () => (items.isPending ? [] : (items.data ?? []));
  /** The vault list, or undefined while it loads or after it failed without data. */
  const availableItems = () => (items.isPending ? undefined : items.data);
  const loadedFolders = () => (folders.isPending ? [] : (folders.data ?? []));

  const [selection, setSelection] = createSignal<VaultSelection>();
  const [filter, setFilter] = createSignal<PasswordFilter>('all');
  const [search, setSearch] = createSignal('');
  const [listView, setListView] = makePersistedState(
    createStore<PasswordListView>(defaultPasswordListView()),
    {
      storages: options.entry
        ? [createPasswordListViewStorage(options.entry)]
        : [],
    }
  );
  /** Add or remove one type from the list's type filter. */
  const setKindSelected = (kind: PasswordKind, selected: boolean) =>
    setListView('kinds', (kinds) =>
      selected
        ? kinds.includes(kind)
          ? kinds
          : PASSWORD_KINDS.filter(
              (each) => each === kind || kinds.includes(each)
            )
        : kinds.filter((each) => each !== kind)
    );
  const [state, setState] = createStore<DraftState>({ drafts: {}, order: [] });
  const bookkeeping = new Map<string, DraftBookkeeping>();
  const [values, setValues] = createSignal<PasswordValues>();
  const [username, setUsername] = createSignal<string>();
  const [usernameLoading, setUsernameLoading] = createSignal(false);
  const [usernameCopied, setUsernameCopied] = createSignal(false);
  const [failure, setFailure] = createSignal<PasswordFailure>();
  const [history, setHistory] = createSignal<PasswordVersion[]>([]);
  const [activity, setActivity] = createSignal<PasswordActivity[]>([]);
  const [copied, setCopied] = createSignal(false);
  const [code, setCode] = createSignal<{
    code: string;
    validUntil: string;
    period: number;
  }>();
  const [codeFailed, setCodeFailed] = createSignal(false);
  let requestGeneration = 0;
  let usernameGeneration = 0;
  let codePending = false;
  let revealTimer: ReturnType<typeof setTimeout> | undefined;

  const selectedId = () => {
    const current = selection();
    return current?.kind === 'item' ? current.id : undefined;
  };
  const selected = (): PasswordItem | undefined => {
    const current = selection();
    if (current?.kind !== 'item') return undefined;
    return loadedItems().find((item) => item.id === current.id);
  };
  const activeDraft = (): VaultDraft | undefined => {
    const current = selection();
    if (!current) return undefined;
    return current.kind === 'draft'
      ? state.drafts[current.key]
      : state.drafts[editKey(current.id)];
  };
  const dirty = () => Object.keys(state.drafts).length > 0;

  /** Hide revealed values; drafts and the selection are untouched. */
  const conceal = () => {
    requestGeneration++;
    setValues(undefined);
    setCopied(false);
    setCode(undefined);
    setCodeFailed(false);
    if (revealTimer) clearTimeout(revealTimer);
    revealTimer = undefined;
  };
  function clearUsername() {
    usernameGeneration++;
    setUsername(undefined);
    setUsernameLoading(false);
    setUsernameCopied(false);
  }
  async function loadUsername(item: PasswordItem) {
    const generation = ++usernameGeneration;
    setUsername(undefined);
    setUsernameLoading(true);
    setUsernameCopied(false);
    const response = await source.username(item.id);
    if (stale()) return;
    if (generation !== usernameGeneration || selectedId() !== item.id) return;
    setUsernameLoading(false);
    if (response.isErr()) {
      setFailure(response.error);
      return;
    }
    setUsername(response.value.username);
  }
  function resetDetail() {
    conceal();
    clearUsername();
    setFailure(undefined);
    setHistory([]);
    setActivity([]);
  }
  function select(item: PasswordItem | undefined) {
    resetDetail();
    setSelection(item ? { kind: 'item', id: item.id } : undefined);
    if (item?.kind !== 'note' && item)
      fireAndForget(loadUsername(item), 'passwords');
  }
  /**
   * No answer from Macro, or a service that answered it can't serve the vault
   * right now: the last request for the selected item, or the latest list
   * reload. The list on screen may be out of date until it answers.
   */
  const connectionProblem = (): ConnectionProblem | undefined => {
    const last = failure();
    if (last === 'unreachable' || last === 'serviceUnavailable') return last;
    if (!items.isError) return undefined;
    if (isUnreachable(items.error)) return 'unreachable';
    if (isServiceUnavailable(items.error)) return 'serviceUnavailable';
    return undefined;
  };
  /** Ask again: reload the list and folders, and the selected item's username. */
  function retryConnection() {
    fireAndForget(items.refetch(), 'passwords');
    fireAndForget(folders.refetch(), 'passwords');
    const current = selection();
    if (current?.kind === 'item') select(selected());
  }
  function selectDraft(key: string) {
    resetDetail();
    setSelection({ kind: 'draft', key });
  }
  function emptyValues(kind: PasswordKind): PasswordValues {
    return {
      username: '',
      password: '',
      notes: '',
      fields: KIND_LAYOUTS[kind].template.map((entry) => ({
        label: t(`passwords.field_${entry.field}`),
        value: '',
      })),
    };
  }
  /** Start a new item of the chosen kind; any other open draft is kept. */
  function createItem(kind: PasswordKind, folderId: string | null) {
    const key = `new:${crypto.randomUUID()}`;
    setState(
      produce((draftState) => {
        draftState.drafts[key] = {
          key,
          draft: {
            name: '',
            kind,
            url: '',
            folderId,
            favorite: false,
            private: false,
            values: emptyValues(kind),
          },
          totpKey: '',
          busy: false,
        };
        draftState.order.unshift(key);
      })
    );
    selectDraft(key);
    return key;
  }
  function updateDraft(key: string, draft: PasswordDraft) {
    if (!state.drafts[key]) return;
    setState('drafts', key, { draft, validation: undefined });
  }
  function setDraftTotpKey(key: string, totpKey: string) {
    if (!state.drafts[key]) return;
    setState('drafts', key, { totpKey, validation: undefined });
  }
  function removeDraft(key: string) {
    bookkeeping.delete(key);
    setState(
      produce((draftState) => {
        delete draftState.drafts[key];
        draftState.order = draftState.order.filter((entry) => entry !== key);
      })
    );
  }
  /** Explicitly throw away a draft's typed values. */
  function discard(key: string) {
    const entry = state.drafts[key];
    if (!entry) return;
    removeDraft(key);
    const current = selection();
    if (current?.kind === 'draft' && current.key === key) {
      const item = entry.itemId
        ? loadedItems().find((candidate) => candidate.id === entry.itemId)
        : undefined;
      select(item);
    }
  }
  function discardAll() {
    for (const key of Object.keys(state.drafts)) removeDraft(key);
  }
  async function refreshUsedItem(itemId: string, generation: number) {
    await items.refetch();
    if (generation !== requestGeneration || selected()?.id !== itemId) return;
  }
  function scheduleConceal() {
    if (revealTimer) clearTimeout(revealTimer);
    revealTimer = setTimeout(conceal, REVEAL_WINDOW_MS);
  }
  async function reveal(version?: number) {
    const item = selected();
    if (!item) return;
    const generation = ++requestGeneration;
    const response = await source.reveal(item.id, version);
    if (stale()) return;
    if (generation !== requestGeneration) return;
    if (response.isErr()) {
      setFailure(response.error);
      return;
    }
    setFailure(undefined);
    setValues(response.value.values);
    scheduleConceal();
    await refreshUsedItem(item.id, generation);
  }
  /** Open the selected item for in-place editing; needs a fresh reveal. */
  async function edit() {
    const item = selected();
    // The server refuses the write too; never open an edit it would reject.
    if (!item?.canEdit) return;
    const key = editKey(item.id);
    if (state.drafts[key]) return;
    const generation = ++requestGeneration;
    const response = await source.reveal(item.id);
    if (stale()) return;
    if (generation !== requestGeneration || selectedId() !== item.id) return;
    if (response.isErr()) {
      setFailure(response.error);
      return;
    }
    setFailure(undefined);
    setState('drafts', key, {
      key,
      itemId: item.id,
      version: item.version,
      draft: {
        name: item.name,
        kind: item.kind,
        url: item.url ?? '',
        folderId: item.folderId,
        favorite: item.favorite,
        private: !item.sharedWithTeam,
        values: structuredClone(response.value.values),
      },
      totpKey: '',
      busy: false,
    });
    conceal();
  }
  function validate(entry: VaultDraft) {
    const invalid = validateDraft(entry.draft);
    if (invalid) return invalid;
    const needsSeed =
      KIND_LAYOUTS[entry.draft.kind].totp === 'required' &&
      !entry.totpKey.trim() &&
      !(
        entry.itemId &&
        loadedItems().find((item) => item.id === entry.itemId)?.hasTotp
      );
    return needsSeed ? 'totp' : undefined;
  }
  async function writeDraft(entry: VaultDraft, notes: DraftBookkeeping) {
    if (notes.saved === entry.draft && entry.itemId)
      return { id: entry.itemId, version: entry.version };
    if (notes.submitted !== entry.draft) {
      notes.operationId = uuidv7();
      notes.submitted = entry.draft;
    }
    notes.operationId ??= uuidv7();
    const response = await source.save(
      entry.itemId,
      entry.version,
      entry.draft,
      notes.operationId
    );
    if (response.isErr()) return response.error;
    notes.saved = entry.draft;
    notes.operationId = undefined;
    return { id: response.value.id, version: response.value.version };
  }
  /**
   * Save a draft. A verification-code seed enrolls after the item exists; if
   * that fails the draft stays open against the saved item, and Save retries
   * only the enrollment.
   */
  async function save(key: string) {
    const entry = state.drafts[key];
    if (!entry || entry.busy) return;
    const invalid = validate(entry);
    setState('drafts', key, { validation: invalid, failure: undefined });
    if (invalid) return;
    setState('drafts', key, 'busy', true);
    // One trace for the whole save: the item write and any seed enrollment
    // are children of it even though they start after awaits.
    try {
      await Telemetry.span('passwords.item.save', (span) =>
        saveDraft(key, entry, span)
      );
    } finally {
      if (state.drafts[key]?.busy) setState('drafts', key, 'busy', false);
    }
  }
  async function saveDraft(key: string, entry: VaultDraft, span: Span) {
    span.setAttr('passwords.item.kind', entry.draft.kind);
    span.setAttr('passwords.item.new', !entry.itemId);
    const notes = bookkeeping.get(key) ?? {};
    bookkeeping.set(key, notes);
    const written = await span.run(() => writeDraft(entry, notes));
    if (stale()) return;
    if (typeof written === 'string') {
      span.setAttr('passwords.outcome', written);
      await keepFailedDraft(key, written, span);
      return;
    }
    if (state.drafts[key])
      setState('drafts', key, { itemId: written.id, version: written.version });
    if (!(await enrollSeed(key, written.id, span))) return;
    span.setAttr('passwords.outcome', 'saved');
    await finishSave(key, written.id, notes, span);
  }
  async function keepFailedDraft(
    key: string,
    failure: PasswordFailure,
    span: Span
  ) {
    setState('drafts', key, { busy: false, failure });
    if (failure !== 'folderMissing') return;
    await span.run(() => folders.refetch());
    if (state.drafts[key]) setState('drafts', key, 'draft', 'folderId', null);
  }
  /** Enrolls a pending seed; on failure the draft stays open on the saved item. */
  async function enrollSeed(key: string, itemId: string, span: Span) {
    const seed = state.drafts[key]?.totpKey.trim();
    if (!seed) return true;
    const enrolled = await span.run(() => source.setTotp(itemId, seed));
    if (stale()) return false;
    if (enrolled.isOk()) return true;
    span.setAttr('passwords.outcome', 'totp_failed');
    await span.run(() => items.refetch());
    if (state.drafts[key])
      setState('drafts', key, { busy: false, failure: 'totp' });
    return false;
  }
  async function finishSave(
    key: string,
    itemId: string,
    notes: DraftBookkeeping,
    span: Span
  ) {
    const savedDraft = state.drafts[key];
    if (savedDraft?.draft === notes.saved) removeDraft(key);
    else if (savedDraft) setState('drafts', key, { busy: false, totpKey: '' });
    const refreshed = await span.run(() => items.refetch());
    const current = selection();
    const stillShowing =
      (current?.kind === 'draft' && current.key === key) ||
      (current?.kind === 'item' && current.id === itemId);
    if (!stillShowing || state.drafts[key]) return;
    select(refreshed.data?.find((candidate) => candidate.id === itemId));
  }
  async function copyPassword() {
    const item = selected();
    if (!item) return;
    const generation = requestGeneration;
    const response = await source.copy(item.id);
    if (stale()) return;
    if (generation !== requestGeneration) return;
    if (response.isErr()) {
      setFailure(response.error);
      return;
    }
    const written = await catchToResult(() =>
      writeClipboard(response.value.values.password)
    );
    if (generation !== requestGeneration) return;
    if (written.isErr()) setFailure('failed');
    else setCopied(true);
    await refreshUsedItem(item.id, generation);
  }
  async function copyUsername() {
    const item = selected();
    if (!item) return;
    const generation = requestGeneration;
    const identifierGeneration = usernameGeneration;
    const response = await source.copyUsername(item.id);
    if (stale()) return;
    if (
      generation !== requestGeneration ||
      identifierGeneration !== usernameGeneration
    )
      return;
    if (response.isErr()) {
      setFailure(response.error);
      return;
    }
    const written = await catchToResult(() =>
      writeClipboard(response.value.username)
    );
    if (
      generation !== requestGeneration ||
      identifierGeneration !== usernameGeneration
    )
      return;
    if (written.isErr()) setFailure('failed');
    else {
      setUsername(response.value.username);
      setUsernameCopied(true);
    }
    await refreshUsedItem(item.id, generation);
  }
  /** Copy a revealed value (notes, a custom field, a code). */
  async function copyValue(value: string) {
    if (stale()) return false;
    const written = await catchToResult(() => writeClipboard(value));
    if (stale()) return false;
    if (written.isErr()) setFailure('failed');
    return written.isOk();
  }
  async function loadHistory() {
    const item = selected();
    if (!item) return;
    const generation = requestGeneration;
    const response = await source.history(item.id);
    if (stale()) return;
    if (generation !== requestGeneration || selectedId() !== item.id) return;
    if (response.isErr()) {
      setFailure(response.error);
      return;
    }
    setHistory(response.value);
  }
  async function loadActivity() {
    const item = selected();
    if (!item) return;
    const generation = requestGeneration;
    const response = await source.activity(item.id);
    if (stale()) return;
    if (generation !== requestGeneration || selectedId() !== item.id) return;
    if (response.isErr()) {
      setFailure(response.error);
      return;
    }
    setActivity(response.value);
  }
  async function move(item: PasswordItem, folderId: string | null) {
    const response = await source.move(item, folderId);
    if (stale()) return;
    if (response.isErr()) {
      setFailure(response.error);
      if (response.error === 'folderMissing') await folders.refetch();
      return;
    }
    await items.refetch();
  }
  async function toggleFavorite(item: PasswordItem) {
    const id = item.id;
    if (stale() || favoritePending().has(id)) return;
    const previous = item.favorite;
    const favorite = !previous;
    const key = passwordKeys.items(scope.key).queryKey;
    const update = (value: boolean) =>
      queryClient.setQueryData<PasswordItem[]>(key, (current) =>
        current?.map((entry) =>
          entry.id === id ? { ...entry, favorite: value } : entry
        )
      );
    setFavoritePending((current) => new Set([...current, id]));
    setFailure(undefined);
    try {
      await queryClient.cancelQueries({ queryKey: key });
      if (stale()) return;
      update(favorite);
      const response = await source.setFavorite(id, favorite);
      if (stale()) return;
      if (response.isErr()) {
        update(previous);
        setFailure(response.error);
        return;
      }
      await items.refetch();
    } finally {
      setFavoritePending(
        (current) => new Set([...current].filter((pending) => pending !== id))
      );
    }
  }
  async function share(grants: PasswordGrant[]) {
    const item = selected();
    if (!item) return;
    const generation = requestGeneration;
    const response = await source.share(item.id, grants);
    if (stale()) return;
    if (generation !== requestGeneration) return;
    if (response.isErr()) {
      setFailure(response.error);
      return false;
    }
    await items.refetch();
    return true;
  }
  /** The new folder; false when the vault refused or failed to create it. */
  async function createFolder(name: string, parentId: string | null) {
    if (!name.trim()) return;
    const response = await source.createFolder(name.trim(), parentId);
    if (stale()) return;
    if (response.isErr()) return false;
    await folders.refetch();
    return response.value;
  }
  async function renameFolder(id: string, name: string) {
    if (!name.trim()) return false;
    const response = await source.renameFolder(id, name.trim());
    if (stale()) return;
    if (response.isErr()) {
      setFailure(response.error);
      return false;
    }
    await folders.refetch();
    return true;
  }
  async function moveFolder(id: string, parentId: string | null) {
    const response = await source.moveFolder(id, parentId);
    if (stale()) return;
    if (response.isErr()) {
      setFailure(response.error);
      return false;
    }
    await folders.refetch();
    return true;
  }
  /** Delete a folder and its subfolders; their items move to All items. */
  async function deleteFolder(id: string) {
    const removed = folderSubtree(loadedFolders(), id);
    const response = await source.deleteFolder(id);
    if (stale()) return;
    if (response.isErr()) {
      setFailure(response.error);
      return false;
    }
    const current = filter();
    if (current.startsWith('folder:') && removed.has(current.slice(7)))
      setFilter('all');
    for (const entry of Object.values(state.drafts))
      if (entry.draft.folderId && removed.has(entry.draft.folderId))
        setState('drafts', entry.key, 'draft', 'folderId', null);
    await Promise.all([folders.refetch(), items.refetch()]);
    return true;
  }
  async function remove() {
    const item = selected();
    if (!item) return;
    const generation = requestGeneration;
    const response = await source.remove(item.id);
    if (stale()) return;
    if (generation !== requestGeneration) {
      await items.refetch();
      return;
    }
    if (response.isErr()) {
      setFailure(response.error);
      return;
    }
    removeDraft(editKey(item.id));
    select(undefined);
    await items.refetch();
  }
  async function setTotp(key: string) {
    const item = selected();
    if (!item) return;
    const generation = requestGeneration;
    const response = key
      ? await source.setTotp(item.id, key)
      : await source.removeTotp(item.id);
    if (stale()) return;
    if (generation !== requestGeneration) return;
    if (response.isErr()) {
      setFailure(response.error);
      return;
    }
    setCode(undefined);
    await items.refetch();
    return true;
  }
  async function loadCode() {
    const item = selected();
    if (!item || codePending) return;
    const generation = requestGeneration;
    codePending = true;
    setCodeFailed(false);
    const response = await source.totp(item.id);
    if (stale()) return;
    codePending = false;
    if (generation !== requestGeneration) return;
    if (response.isErr()) {
      setCode(undefined);
      setCodeFailed(true);
      return;
    }
    setCode(response.value);
    scheduleConceal();
  }
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (dirty()) event.preventDefault();
  };
  const hide = () => {
    if (document.hidden) conceal();
  };
  window.addEventListener('blur', conceal);
  document.addEventListener('visibilitychange', hide);
  window.addEventListener('beforeunload', beforeUnload);
  onCleanup(() => {
    conceal();
    clearUsername();
    window.removeEventListener('blur', conceal);
    document.removeEventListener('visibilitychange', hide);
    window.removeEventListener('beforeunload', beforeUnload);
  });
  return {
    items,
    folders,
    loadedItems,
    availableItems,
    loadedFolders,
    selection,
    selected,
    select,
    selectDraft,
    filter,
    setFilter,
    search,
    setSearch,
    kinds: () => listView.kinds,
    setKindSelected,
    clearKinds: () => setListView('kinds', []),
    groupBy: () => listView.groupBy,
    setGroupBy: (groupBy: PasswordGroupBy) => setListView('groupBy', groupBy),
    drafts: () => state.order.map((key) => state.drafts[key]),
    draft: (key: string): VaultDraft | undefined => state.drafts[key],
    activeDraft,
    dirty,
    createItem,
    updateDraft,
    setDraftTotpKey,
    discard,
    discardAll,
    edit,
    save,
    values,
    username,
    usernameLoading,
    usernameCopied,
    failure,
    connectionProblem,
    retryConnection,
    reveal,
    copy: copyPassword,
    copyUsername,
    copyValue,
    copied,
    conceal,
    /** Client-side only: hides revealed values. Drafts and the session stay. */
    lock: conceal,
    history,
    loadHistory,
    activity,
    loadActivity,
    share,
    move,
    toggleFavorite,
    favoritePending: (id: string) => favoritePending().has(id),
    createFolder,
    renameFolder,
    moveFolder,
    deleteFolder,
    remove,
    code,
    codeFailed,
    loadCode,
    setTotp,
    visibleItems: () =>
      filterItems(
        loadedItems(),
        filter(),
        search(),
        loadedFolders(),
        listView.kinds
      ),
  };
}
export type VaultController = ReturnType<typeof createVault>;
