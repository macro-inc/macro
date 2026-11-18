import type { EditorView } from '@macro-inc/lexical-wasm-view';
import type { LatestPublishedObserver } from '@macro-inc/lexical-wasm-view/view/latest-published';
import {
  SessionPort,
  selectionMessage,
} from '@macro-inc/lexical-wasm-view/view/session-port';
import { createSignal } from 'solid-js';
import type { TaskInfo } from './model';
import { observeChecklistCalendar } from './native-calendar';
import { NativeChecklistPlanState } from './native-plan-state';

/** External provider facts only; document metadata and all policy remain native. */
export interface ChecklistProviderFacts {
  readonly tasks: Readonly<Record<string, TaskInfo>>;
  readonly names: ReadonlyMap<string, string>;
}

// Session ownership survives visual overlay remounts, without retaining the view.
const hosts = new WeakMap<EditorView, object>();

/**
 * Construct before the session, pass observer at construction, then ready() only
 * from the public runtime's real Initialize fence. Observation never enters native.
 */
export function createNativeChecklistPlanHost(
  report: (error: unknown) => void
) {
  const identity = {};
  const state = new NativeChecklistPlanState();
  const [plans, setPlans] = createSignal(state.current());
  const [presentation, setPresentation] = createSignal(0);
  const [taskIds, setTaskIds] = createSignal<string[]>([]);
  const listTaskIds = new Map<number, string[]>();
  let taskGeneration: number | null = null;
  const [dueStrings, setDueStrings] = createSignal<readonly string[]>([]);
  const dates = new Map<number, string>();
  let view: EditorView | undefined;
  let generation: number | null = null;
  let release: Array<() => void> = [];
  let enabled = false;
  let retired = false;
  let scheduled = false;
  let sending = false;
  let provider: ChecklistProviderFacts | undefined;
  let providerSignature: string | undefined;
  let calendarDay: string | undefined;
  let version = 0n;
  let pending: { generation: number; json: string } | undefined;
  let midnight: ReturnType<typeof setTimeout> | undefined;

  const notify = (error: unknown) => {
    try {
      report(error);
    } catch {
      /* Optional diagnostics never replace native output. */
    }
  };
  const retire = () => {
    if (retired) return;
    retired = true;
    enabled = false;
    if (midnight !== undefined) clearTimeout(midnight);
    for (const cleanup of release.reverse()) {
      try {
        cleanup();
      } catch (error) {
        notify(error);
      }
    }
    release = [];
    dates.clear();
    setDueStrings([]);
    state.retire();
    listTaskIds.clear();
    provider = undefined;
    providerSignature = undefined;
    calendarDay = undefined;
    pending = undefined;
    view = undefined;
    setTaskIds([]);
    setPlans(new Map());
  };
  const unavailable = (error: unknown) => {
    if (retired) return;
    retire();
    notify(error);
  };
  const schedule = () => {
    if (retired || scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (!enabled || !view || retired || sending) return;
      send().catch(unavailable);
    });
  };
  const prepare = () => {
    if (!provider || generation === null) return;
    const tasks = Object.fromEntries(
      Object.entries(provider.tasks).sort(([a], [b]) => a.localeCompare(b))
    );
    const names = Object.fromEntries(
      [...provider.names].sort(([a], [b]) => a.localeCompare(b))
    );
    const due = new Set(dueStrings());
    for (const task of Object.values(tasks))
      if (task.due !== null) due.add(task.due);
    const today = new Date();
    const day = [today.getFullYear(), today.getMonth(), today.getDate()].join(
      '/'
    );
    const signature = JSON.stringify({ tasks, names, due: [...due].sort() });
    if (
      signature === providerSignature &&
      day === calendarDay &&
      pending?.generation === generation
    )
      return;
    if (signature === providerSignature && day === calendarDay && !pending)
      return;
    if (version === 0xffff_ffff_ffff_ffffn)
      throw new Error('Checklist facts revision exhausted');
    version += 1n;
    pending = {
      generation,
      json: JSON.stringify({
        factsVersion: version.toString(),
        tasks,
        names,
        calendar: observeChecklistCalendar(today, due),
      }),
    };
    providerSignature = signature;
    calendarDay = day;
    if (midnight !== undefined) clearTimeout(midnight);
    const next = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 1
    );
    midnight = setTimeout(
      () => {
        if (retired) return;
        calendarDay = undefined;
        try {
          prepare();
          schedule();
        } catch (error) {
          unavailable(error);
        }
      },
      Math.max(1, next.getTime() - today.getTime())
    );
  };
  const send = async () => {
    const current = view;
    if (!current || !pending || retired) return;
    const receipt = pending;
    sending = true;
    try {
      if (!(current.port instanceof SessionPort))
        throw new Error('Checklist facts require the native session port');
      const result = await current.port.inputSettled(() => {
        if (
          retired ||
          !enabled ||
          current !== view ||
          current.mirror.keyGeneration !== receipt.generation
        )
          throw new Error('Checklist facts target retired before admission');
        return {
          name: 'group-b.set-checklist-facts',
          json: receipt.json,
          generation: receipt.generation,
          selection: selectionMessage({ kind: 'keep' }),
        };
      });
      if (result.status === 'error') throw result.error;
      if (result.status === 'cancelled')
        throw new Error('Checklist facts admission cancelled');
      if (pending === receipt) pending = undefined;
    } catch (error) {
      // Unknown application/transfer is sticky. Never replay the input automatically.
      unavailable(error);
    } finally {
      sending = false;
      if (!retired && pending) schedule();
    }
  };
  const changedDates = () => {
    const next = [...new Set(dates.values())].sort();
    if (JSON.stringify(next) === JSON.stringify(dueStrings())) return;
    setDueStrings(next);
    prepare();
    schedule();
  };
  const observe = (current: EditorView) => {
    const nextGeneration = current.mirror.keyGeneration;
    if (nextGeneration === null || retired) return;
    if (view && view !== current)
      throw new Error('Checklist host cannot change session owners');
    if (!view) {
      const existing = hosts.get(current);
      if (existing && existing !== identity)
        throw new Error('Checklist session already has a host');
      hosts.set(current, identity);
      view = current;
      release.push(
        current.onPluginEvent('group-b.checklist-plan-updates', (payload) => {
          try {
            const actualGeneration = current.mirror.keyGeneration;
            if (actualGeneration === null)
              throw new Error('Checklist delivery without a mirror generation');
            state.receive(payload, actualGeneration);
            setPlans(state.current());
            if (taskGeneration !== actualGeneration) {
              taskGeneration = actualGeneration;
              listTaskIds.clear();
            }
            for (const key of listTaskIds.keys())
              if (!state.current().has(key)) listTaskIds.delete(key);
            for (const [key, list] of state.current()) {
              if (list.result.kind !== 'planned') continue;
              listTaskIds.set(
                key,
                list.result.items.flatMap((item) =>
                  item.taskId.kind === 'value' && item.taskId.value
                    ? [item.taskId.value]
                    : []
                )
              );
            }
            const ids = [...new Set([...listTaskIds.values()].flat())].sort();
            setTaskIds((before) =>
              JSON.stringify(before) === JSON.stringify(ids) ? before : ids
            );
          } catch (error) {
            unavailable(error);
          }
        })
      );
      release.push(
        current.onMutations('date-mention', (mutations) => {
          try {
            for (const [key] of mutations) {
              const date = current.node(key)?.props().date;
              if (typeof date === 'string') dates.set(key, date);
              else dates.delete(key);
            }
            changedDates();
          } catch (error) {
            unavailable(error);
          }
        })
      );
    }
    if (generation !== nextGeneration) {
      generation = nextGeneration;
      dates.clear();
      for (const node of current.mirror.values()) {
        if (node.type !== 'date-mention') continue;
        const date = node.props().date;
        if (typeof date === 'string') dates.set(node.key, date);
      }
      // A new actual core needs an explicit full producer reset, even for equal facts.
      providerSignature = undefined;
      calendarDay = undefined;
      changedDates();
      prepare();
      schedule();
    }
    setPresentation((revision) => revision + 1);
  };
  const observer: LatestPublishedObserver = {
    published: observe,
    unavailable: (reason) => unavailable(reason),
    retired: retire,
  };
  return {
    observer,
    fail: unavailable,
    plans,
    taskIds,
    presentation,
    observedSequence() {
      if (retired || !enabled || !view || !view.isMounted) return undefined;
      const current = view.mirror.keyGeneration;
      if (current === null || current !== generation) return undefined;
      return state.observedSequence(current);
    },
    /** This is called by the real Initialize-gated public runtime, never inferred. */
    ready(current: EditorView) {
      if (retired) return;
      try {
        observe(current);
        enabled = true;
        prepare();
        schedule();
      } catch (error) {
        unavailable(error);
      }
    },
    updateFacts(facts: ChecklistProviderFacts) {
      if (retired) return;
      provider = facts;
      try {
        prepare();
        schedule();
      } catch (error) {
        unavailable(error);
      }
    },
    dispose: retire,
  };
}
export type NativeChecklistPlanHost = ReturnType<
  typeof createNativeChecklistPlanHost
>;
