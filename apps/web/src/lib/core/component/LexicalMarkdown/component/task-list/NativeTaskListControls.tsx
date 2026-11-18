import type { EditorView } from '@macro-inc/lexical-wasm-view';
import {
  type Accessor,
  createComponent,
  createEffect,
  createMemo,
  createSignal,
  ErrorBoundary,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import type { NormalizedSettings } from '../../plugins/checklist-controls/model';
import { dispatchNativeChecklistSettings } from '../../plugins/checklist-controls/native-checklist-intent';
import type { NativeChecklistPlanHost } from '../../plugins/checklist-controls/native-plan-host';
import type { NativeChecklistBar } from '../../plugins/checklist-controls/native-plan-schema';
import { TaskListBar } from './TaskListBar';
import { createTaskListNames, createTaskListTaskInfo } from './task-list-facts';

/** Runs the same actual contact/task providers, without calling the Source planner. */
export function NativeChecklistFacts(props: { host: NativeChecklistPlanHost }) {
  return (
    <ErrorBoundary
      fallback={(error) => {
        props.host.fail(error);
        return null;
      }}
    >
      {createComponent(ChecklistProvider, { host: props.host })}
    </ErrorBoundary>
  );
}
function ChecklistProvider(props: { host: NativeChecklistPlanHost }) {
  const tasks = createTaskListTaskInfo(props.host.taskIds);
  const { nameById } = createTaskListNames(() =>
    Object.values(tasks()).flatMap((task) => task.assigneeIds)
  );
  createEffect(() =>
    props.host.updateFacts({ tasks: tasks(), names: nameById() })
  );
  return null;
}

/** Each optional overlay owns its Solid effects; failure leaves native output alone. */
export function NativeChecklistOverlay(props: {
  view: EditorView;
  host: NativeChecklistPlanHost;
}) {
  return (
    <ErrorBoundary
      fallback={(error) => {
        props.host.fail(error);
        return null;
      }}
    >
      {createComponent(NativeTaskListControls, {
        view: props.view,
        host: props.host,
        report: props.host.fail,
      })}
    </ErrorBoundary>
  );
}

/** Portals only native planned bars; malformed/missing plans never acquire fallback policy. */
export function NativeTaskListControls(props: {
  view: EditorView;
  host: NativeChecklistPlanHost;
  report: (error: unknown) => void;
}) {
  const mounts = new Map<
    number,
    {
      key: number;
      generation: number;
      bar: HTMLElement;
      result: NativeChecklistBar;
    }
  >();
  const lists = createMemo(() => {
    props.host.presentation();
    const next = [...props.host.plans().values()].flatMap((entry) => {
      if (
        entry.key.generation !== props.view.mirror.keyGeneration ||
        entry.result.kind !== 'planned'
      )
        return [];
      const bar = props.view
        .getElementByKey(entry.key.index)
        ?.querySelector<HTMLElement>(':scope > .mdtl-bar-mount');
      if (!bar) return [];
      // Source's shared filter UI accepts string assignee identities only.
      // A noncanonical stored identity is a visible-UI coverage boundary, not normalization.
      if (
        entry.result.items.some((item) =>
          item.assignees.some((assignee) => assignee.id.kind !== 'value')
        )
      )
        return [];
      let mount = mounts.get(entry.key.index);
      if (
        !mount ||
        mount.bar !== bar ||
        mount.generation !== entry.key.generation
      ) {
        mount = {
          key: entry.key.index,
          generation: entry.key.generation,
          bar,
          result: entry.result,
        };
        mounts.set(entry.key.index, mount);
      }
      return [mount];
    });
    const present = new Set(next.map((entry) => entry.key));
    for (const key of mounts.keys()) if (!present.has(key)) mounts.delete(key);
    return next;
  });
  let dimmed = new Set<number>();
  const clear = () => {
    for (const key of dimmed)
      props.view.getElementByKey(key)?.classList.remove('mdtl-dim');
    dimmed = new Set();
  };
  createEffect(() => {
    props.host.presentation();
    clear();
    for (const entry of props.host.plans().values()) {
      if (
        entry.key.generation !== props.view.mirror.keyGeneration ||
        entry.result.kind !== 'planned'
      )
        continue;
      for (const row of entry.result.rows) {
        props.view
          .getElementByKey(row.key.index)
          ?.classList.toggle('mdtl-dim', row.dimmed);
        if (row.dimmed) dimmed.add(row.key.index);
      }
    }
  });
  onCleanup(clear);
  return (
    <For each={lists()}>
      {(entry) => (
        <NativeTaskListEntry
          view={props.view}
          bar={entry.bar}
          key={entry.key}
          result={() => {
            const actual = props.host.plans().get(entry.key);
            return actual?.result.kind === 'planned'
              ? actual.result
              : entry.result;
          }}
          observedSequence={props.host.observedSequence}
          report={props.report}
        />
      )}
    </For>
  );
}

function NativeTaskListEntry(props: {
  view: EditorView;
  key: number;
  bar: HTMLElement;
  result: Accessor<NativeChecklistBar>;
  observedSequence: () => string | undefined;
  report: (error: unknown) => void;
}) {
  const [hovered, setHovered] = createSignal(false);
  const [available, setAvailable] = createSignal(true);
  const list = props.bar.parentElement;
  let active = true;
  const enter = () => setHovered(true);
  const leave = () => setHovered(false);
  list?.addEventListener('pointerenter', enter);
  list?.addEventListener('pointerleave', leave);
  onCleanup(() => {
    active = false;
    list?.removeEventListener('pointerenter', enter);
    list?.removeEventListener('pointerleave', leave);
  });
  const items = createMemo(() =>
    props.result().items.map((item) => ({
      assignees: item.assignees.map((assignee) => {
        if (assignee.id.kind !== 'value')
          throw new Error('Checklist UI requires a string assignee identity');
        return { id: assignee.id.value, name: assignee.name };
      }),
    }))
  );
  const update = async (patch: Partial<NormalizedSettings>) => {
    const view = props.view;
    const key = props.key;
    try {
      const observedSequence = props.observedSequence();
      if (observedSequence === undefined)
        throw new Error('Checklist presentation sequence is unavailable');
      const filters = patch.filters ?? props.result().settings.filters;
      const settings = {
        filters: {
          status: [...filters.status],
          priority: [...filters.priority],
          assignees: [...filters.assignees],
          due: [...filters.due],
        },
      };
      const result = await dispatchNativeChecklistSettings(
        view,
        key,
        observedSequence,
        settings,
        () => {
          if (
            !active ||
            !list ||
            props.bar.parentElement !== list ||
            view.getElementByKey(key) !== list
          )
            throw new Error('Checklist settings target is unavailable');
        }
      );
      if (result.status === 'error') throw result.error;
      if (result.status === 'cancelled')
        throw new Error('Checklist settings admission cancelled');
    } catch (error) {
      setAvailable(false);
      try {
        props.report(error);
      } catch {
        /* Optional diagnostics cannot fail native consumption. */
      }
    }
  };
  return (
    <Show when={available()}>
      <Portal mount={props.bar}>
        <TaskListBar
          progress={() => props.result().progress}
          progressPercentage={() => `${props.result().progress.percentage}%`}
          filterCount={() => props.result().filterCount}
          settings={() => props.result().settings}
          items={items}
          hasTasks={() => props.result().hasTasks}
          hovered={hovered}
          update={update}
        />
      </Portal>
    </Show>
  );
}
