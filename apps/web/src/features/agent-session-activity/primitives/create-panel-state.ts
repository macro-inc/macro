import { createEffect, createSignal, on } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type {
  AgentActivityRow,
  AgentActivitySource,
} from '../context/agent-activity-source';
import {
  type AgentActivityItem,
  foldAgentActivityRows,
} from '../core/fold-rows';

/** Hold a rendered snapshot while the list is being read. */
export function createPanelState(source: AgentActivitySource) {
  const [visibleRows, setVisibleRows] = createSignal<AgentActivityRow[]>([]);
  const [held, setHeld] = createSignal(false);
  const [openKey, setOpenKey] = createSignal<string>();
  const [unseenIds, setUnseenIds] = createSignal<string[]>([]);
  const [pendingChanges, setPendingChanges] = createSignal(false);
  const [unseenKeys, setUnseenKeys] = createSignal<string[]>([]);
  const [items, setItems] = createStore<AgentActivityItem[]>([]);
  let initialized = false;

  const catchUp = () => {
    const before = items;
    const next = foldAgentActivityRows(source.rows());
    const changed = next.find((item) => {
      const previous = before.find((old) => old.key === item.key);
      return previous && previous.latest.id !== item.latest.id;
    });
    if (initialized) {
      const newKeys = next
        .filter((item) => {
          const previous = before.find((old) => old.key === item.key);
          return !previous || previous.latest.id !== item.latest.id;
        })
        .map((item) => item.key);
      setUnseenKeys((current) => [...new Set([...current, ...newKeys])]);
    }
    const wasInitialized = initialized;
    if (next.length > 0) initialized = true;
    setVisibleRows(source.rows());
    // A refetch or an older page isn't an update: leave what's open alone.
    const hasNews = next.some((item) => {
      const previous = before.find((old) => old.key === item.key);
      return !previous || previous.latest.id !== item.latest.id;
    });
    if (wasInitialized && hasNews) setOpenKey(changed?.key);
    setItems(reconcile(next, { key: 'key' }));
    setUnseenIds([]);
    setPendingChanges(false);
  };

  createEffect(
    on(source.rows, (rows) => {
      if (held()) {
        const shown = visibleRows();
        const onlyOlderRowsAdded =
          rows.length > shown.length &&
          shown.every((row, index) => rows[index]?.id === row.id);
        if (onlyOlderRowsAdded) {
          setVisibleRows(rows);
          setItems(reconcile(foldAgentActivityRows(rows), { key: 'key' }));
          return;
        }
        const firstShownId = shown[0]?.id;
        const firstShownIndex = rows.findIndex(
          (row) => row.id === firstShownId
        );
        const newRows =
          firstShownIndex >= 0 ? rows.slice(0, firstShownIndex) : rows;
        setUnseenIds(newRows.map((row) => row.id));
        setPendingChanges(
          rows.length !== shown.length ||
            rows.some((row, index) => row.id !== shown[index]?.id)
        );
        return;
      }
      catchUp();
    })
  );

  return {
    items: () => items,
    openKey,
    setOpenKey,
    unseenCount: () => unseenIds().length,
    isUnseen: (key: string) => unseenKeys().includes(key),
    unseenItemCount: () => unseenKeys().length,
    markSeen: (key: string) =>
      setUnseenKeys((current) => current.filter((item) => item !== key)),
    markAllSeen: () => setUnseenKeys([]),
    hold: () => setHeld(true),
    release: () => {
      setHeld(false);
      if (pendingChanges()) catchUp();
    },
    catchUp,
  };
}
