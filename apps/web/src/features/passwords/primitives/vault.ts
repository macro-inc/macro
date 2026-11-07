import { fireAndForget } from '@core/util/fireAndForget';
import { catchToResult } from '@core/util/result';
import { useQuery } from '@tanstack/solid-query';
import { createSignal, onCleanup } from 'solid-js';
import { v7 as uuidv7 } from 'uuid';
import {
  type PasswordFailure,
  usePasswords,
} from '../context/passwords-context';
import {
  filterItems,
  type PasswordActivity,
  type PasswordDraft,
  type PasswordFilter,
  type PasswordGrant,
  type PasswordItem,
  type PasswordValues,
  type PasswordVersion,
  validateDraft,
} from '../core/types';
import { passwordKeys } from '../queries/keys';

export function createVault(teamId: string) {
  const { source, writeClipboard } = usePasswords();
  const items = useQuery(() => ({
    queryKey: passwordKeys.items(teamId),
    queryFn: source.list,
    reconcile: 'id',
  }));
  const folders = useQuery(() => ({
    queryKey: passwordKeys.folders(teamId),
    queryFn: source.folders,
    reconcile: 'id',
  }));
  const [selected, setSelected] = createSignal<PasswordItem>();
  const [filter, setFilter] = createSignal<PasswordFilter>('all');
  const [search, setSearch] = createSignal('');
  const [draft, setDraft] = createSignal<PasswordDraft>();
  const [values, setValues] = createSignal<PasswordValues>();
  const [username, setUsername] = createSignal<string>();
  const [usernameLoading, setUsernameLoading] = createSignal(false);
  const [usernameCopied, setUsernameCopied] = createSignal(false);
  const [failure, setFailure] = createSignal<PasswordFailure>();
  const [validation, setValidation] = createSignal<'name' | 'url'>();
  const [busy, setBusy] = createSignal(false);
  const [history, setHistory] = createSignal<PasswordVersion[]>([]);
  const [activity, setActivity] = createSignal<PasswordActivity[]>([]);
  const [pendingSelection, setPendingSelection] = createSignal<{
    item: PasswordItem | undefined;
  }>();
  const [copied, setCopied] = createSignal(false);
  const [code, setCode] = createSignal<{ code: string; validUntil: string }>();
  const [totpKey, setTotpKey] = createSignal('');
  let requestGeneration = 0;
  let usernameGeneration = 0;
  let operationId: string | undefined;
  let submittedDraft: PasswordDraft | undefined;
  let codePending = false;
  let revealTimer: ReturnType<typeof setTimeout> | undefined;
  const conceal = () => {
    requestGeneration++;
    setValues(undefined);
    setCopied(false);
    setCode(undefined);
    setTotpKey('');
    if (revealTimer) clearTimeout(revealTimer);
  };
  const clearDraft = () => {
    operationId = undefined;
    submittedDraft = undefined;
    setDraft(undefined);
    setValidation(undefined);
  };
  const lock = () => {
    conceal();
    clearDraft();
    setPendingSelection(undefined);
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
    if (generation !== usernameGeneration || selected()?.id !== item.id) return;
    setUsernameLoading(false);
    if (response.isErr()) {
      setFailure(response.error);
      return;
    }
    setUsername(response.value.username);
  }
  function select(item: PasswordItem | undefined) {
    if (draft()) {
      setPendingSelection({ item });
      return;
    }
    lock();
    clearUsername();
    setSelected(item);
    setFailure(undefined);
    setHistory([]);
    setActivity([]);
    setCopied(false);
    if (item) fireAndForget(loadUsername(item), 'passwords');
  }
  function discard() {
    clearDraft();
    const pending = pendingSelection();
    setPendingSelection(undefined);
    if (pending) select(pending.item);
  }
  function createItem() {
    if (draft()) return;
    lock();
    clearUsername();
    setSelected(undefined);
    setFailure(undefined);
    setDraft({
      name: '',
      kind: 'login',
      url: '',
      folderId: null,
      favorite: false,
      values: { username: '', password: '', notes: '', fields: [] },
    });
  }
  async function refreshUsedItem(itemId: string, generation: number) {
    const refreshed = await items.refetch();
    if (generation !== requestGeneration || selected()?.id !== itemId) return;
    const metadata = refreshed.data?.find((item) => item.id === itemId);
    if (!metadata) return;
    setSelected((current) =>
      current ? { ...current, lastUsedAt: metadata.lastUsedAt } : current
    );
  }
  async function reveal(version?: number) {
    const item = selected();
    if (!item) return;
    const generation = ++requestGeneration;
    const response = await source.reveal(item.id, version);
    if (generation !== requestGeneration) return;
    if (response.isErr()) {
      setFailure(response.error);
      return;
    }
    setFailure(undefined);
    setValues(response.value.values);
    if (revealTimer) clearTimeout(revealTimer);
    revealTimer = setTimeout(lock, 60_000);
    await refreshUsedItem(item.id, generation);
  }
  async function edit() {
    const item = selected();
    if (!item) return;
    await reveal();
    const revealed = values();
    if (!revealed || selected()?.id !== item.id) return;
    setDraft({
      name: item.name,
      kind: item.kind,
      url: item.url ?? '',
      folderId: item.folderId,
      favorite: item.favorite,
      values: { ...revealed },
    });
    conceal();
  }
  async function save() {
    const current = draft();
    if (!current || busy()) return;
    const invalid = validateDraft(current);
    setValidation(invalid);
    if (invalid) return;
    setBusy(true);
    const generation = requestGeneration;
    if (submittedDraft !== current) {
      operationId = uuidv7();
      submittedDraft = current;
    }
    operationId ??= uuidv7();
    const response = await source.save(
      selected()?.id,
      selected()?.version,
      current,
      operationId
    );
    setBusy(false);
    if (generation !== requestGeneration) {
      await items.refetch();
      return;
    }
    if (response.isErr()) {
      setFailure(response.error);
      return;
    }
    if (draft() === current) clearDraft();
    conceal();
    setSelected(response.value);
    setFailure(undefined);
    await loadUsername(response.value);
    await items.refetch();
  }
  async function copyPassword() {
    const item = selected();
    if (!item) return;
    const generation = requestGeneration;
    const response = await source.copy(item.id);
    if (generation !== requestGeneration) return;
    if (response.isErr()) {
      setFailure(response.error);
      return;
    }
    const copied = await catchToResult(() =>
      writeClipboard(response.value.values.password)
    );
    if (generation !== requestGeneration) return;
    if (copied.isErr()) setFailure('failed');
    else setCopied(true);
    await refreshUsedItem(item.id, generation);
  }
  async function copyUsername() {
    const item = selected();
    if (!item) return;
    const generation = requestGeneration;
    const identifierGeneration = usernameGeneration;
    const response = await source.copyUsername(item.id);
    if (
      generation !== requestGeneration ||
      identifierGeneration !== usernameGeneration
    )
      return;
    if (response.isErr()) {
      setFailure(response.error);
      return;
    }
    const copied = await catchToResult(() =>
      writeClipboard(response.value.username)
    );
    if (
      generation !== requestGeneration ||
      identifierGeneration !== usernameGeneration
    )
      return;
    if (copied.isErr()) setFailure('failed');
    else {
      setUsername(response.value.username);
      setUsernameCopied(true);
    }
    await refreshUsedItem(item.id, generation);
  }
  async function loadHistory() {
    const item = selected();
    if (!item) return;
    const generation = requestGeneration;
    const response = await source.history(item.id);
    if (generation !== requestGeneration) return;
    if (selected()?.id !== item.id) return;
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
    if (generation !== requestGeneration) return;
    if (selected()?.id !== item.id) return;
    if (response.isErr()) {
      setFailure(response.error);
      return;
    }
    setActivity(response.value);
  }
  async function move(item: PasswordItem, folderId: string | null) {
    const response = await source.move(item, folderId);
    if (response.isErr()) {
      setFailure(response.error);
      return;
    }
    if (selected()?.id === item.id) setSelected(response.value);
    await items.refetch();
  }
  async function share(grants: PasswordGrant[]) {
    const item = selected();
    if (!item) return;
    const generation = requestGeneration;
    const response = await source.share(item.id, grants);
    if (generation !== requestGeneration) return;
    if (response.isErr()) {
      setFailure(response.error);
      return false;
    }
    const refreshed = await items.refetch();
    if (generation !== requestGeneration) return true;
    const metadata = refreshed.data?.find((entry) => entry.id === item.id);
    if (metadata) setSelected(metadata);
    return true;
  }
  async function createFolder(name: string) {
    if (!name.trim()) return;
    const response = await source.createFolder(name.trim());
    if (response.isErr()) {
      setFailure(response.error);
      return;
    }
    await folders.refetch();
    return true;
  }
  async function remove() {
    const item = selected();
    if (!item) return;
    const generation = requestGeneration;
    const response = await source.remove(item.id);
    if (generation !== requestGeneration) {
      await items.refetch();
      return;
    }
    if (response.isErr()) {
      setFailure(response.error);
      return;
    }
    lock();
    clearDraft();
    setSelected(undefined);
    clearUsername();
    await items.refetch();
  }
  async function setTotp(key: string) {
    const item = selected();
    if (!item) return;
    const generation = requestGeneration;
    const response = key
      ? await source.setTotp(item.id, key)
      : await source.removeTotp(item.id);
    if (generation !== requestGeneration) return;
    if (response.isErr()) {
      setFailure(response.error);
      return;
    }
    setSelected({ ...item, hasTotp: !!key });
    setCode(undefined);
    await items.refetch();
    return true;
  }
  async function loadCode() {
    const item = selected();
    if (!item) return;
    const generation = requestGeneration;
    if (codePending) return;
    codePending = true;
    setCode(undefined);
    const response = await source.totp(item.id);
    codePending = false;
    if (generation !== requestGeneration) return;
    if (response.isErr()) {
      setFailure(response.error);
      return;
    }
    setCode(response.value);
  }
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (draft()) event.preventDefault();
  };
  const hide = () => {
    if (document.hidden) lock();
  };
  const blur = lock;
  window.addEventListener('blur', blur);
  document.addEventListener('visibilitychange', hide);
  window.addEventListener('beforeunload', beforeUnload);
  onCleanup(() => {
    lock();
    clearUsername();
    window.removeEventListener('blur', blur);
    document.removeEventListener('visibilitychange', hide);
    window.removeEventListener('beforeunload', beforeUnload);
  });
  return {
    items,
    folders,
    selected,
    select,
    filter,
    setFilter,
    search,
    setSearch,
    draft,
    setDraft,
    values,
    username,
    usernameLoading,
    usernameCopied,
    failure,
    validation,
    busy,
    createItem,
    edit,
    save,
    reveal,
    copy: copyPassword,
    copyUsername,
    copied,
    lock,
    history,
    loadHistory,
    activity,
    loadActivity,
    share,
    move,
    createFolder,
    remove,
    code,
    loadCode,
    setTotp,
    totpKey,
    setTotpKey,
    pendingSelection,
    setPendingSelection,
    discard,
    cancel: clearDraft,
    visibleItems: () =>
      filterItems(
        items.isPending ? [] : (items.data ?? []),
        filter(),
        search()
      ),
  };
}
export type VaultController = ReturnType<typeof createVault>;
