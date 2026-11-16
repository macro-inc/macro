import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { Telemetry } from '@macro-inc/observability';
import {
  type Accessor,
  type ComponentProps,
  createSignal,
  onCleanup,
  Show,
} from 'solid-js';
import { HostedActionMenu } from '../component/menu/ActionsMenu';
import { HostedFloatingTableMenu } from '../component/menu/FloatingTableMenu';
import { ACTIONS } from '../plugins/actions/actions';
import { mergeActions } from '../plugins/actions/available-actions';
import { dispatchApplicationCommandSettled } from '../plugins/group-b/command';
import { insertNativeTable } from '../plugins/tables/native';
import type { MenuOperations } from '../shared/inlineMenu';
import {
  createNativeActionMenuHost,
  type NativeActionCommands,
  type NativeActionRequests,
} from './overlay-hosts/native-actions';
import { createNativeListenerScope } from './overlay-hosts/native-listeners';
import { createNativeTablePickerHost } from './overlay-hosts/native-table-picker';

export type NativeActionsOptions = Omit<
  ComponentProps<typeof HostedActionMenu>,
  'host' | 'menu'
> & { requests: Omit<NativeActionRequests, 'requestTable'> };

/** The real menu and picker share the document owner's mounted lifetime. */
export function NativeActionsOverlay(props: {
  view: EditorView;
  menu: MenuOperations;
  source: NativeActionsOptions;
  canEdit: Accessor<boolean>;
  alive: () => boolean;
  own(cleanup: () => void): void;
  onUnavailable(error: unknown): void;
  /** The ready host for the command menu; undefined once it retires. */
  publish?(commands: NativeActionCommands | undefined): void;
}) {
  if (!props.alive()) return null;
  const listeners = createNativeListenerScope();
  props.own(listeners.dispose);
  onCleanup(listeners.dispose);
  if (!props.alive()) return null;
  const [ready, setReady] = createSignal(false);
  const host = createNativeActionMenuHost(
    props.view,
    {
      ...props.source.requests,
      async requestTable() {
        const generation = props.view.mirror.keyGeneration;
        const result = await dispatchApplicationCommandSettled(
          props.view,
          'group-b.table',
          { action: 'picker' }
        );
        if (result.status === 'error') throw result.error;
        if (
          result.status === 'success' &&
          !result.handled &&
          props.alive() &&
          props.view.mirror.keyGeneration === generation
        ) {
          insertNativeTable(props.view, 3, 3, false);
        }
      },
    },
    props.alive
  );
  listeners.add(host.dispose);
  listeners.add(() => props.publish?.(undefined));
  const picker = createNativeTablePickerHost(() =>
    props.alive() ? props.view : undefined
  );
  listeners.add(picker.dispose);
  const unavailable = (error: unknown) => {
    try {
      props.onUnavailable(error);
    } catch (retirementError) {
      try {
        Telemetry.error(retirementError, {
          surface: 'native-action-menu-cleanup',
        });
      } catch {
        // Optional UI retirement must still reach its owned registrations.
      }
    } finally {
      try {
        listeners.dispose();
      } catch (cleanupError) {
        try {
          Telemetry.error(cleanupError, {
            surface: 'native-action-menu-cleanup',
          });
        } catch {
          // A secondary exporter failure cannot interrupt the remaining owner.
        }
      }
    }
  };
  let initialized = false;
  let releaseReady: (() => void) | undefined;
  const stopReady = () => {
    const release = releaseReady;
    releaseReady = undefined;
    release?.();
  };
  const initialize = () => {
    if (
      initialized ||
      !props.alive() ||
      props.view.mirror.keyGeneration === null
    )
      return;
    try {
      // A real empty registry query qualifies this optional native capability.
      if (!host.hasDependencies([]))
        throw new Error('Native action dependency query is unavailable');
      initialized = true;
      stopReady();
      setReady(true);
      props.publish?.(host);
    } catch (error) {
      unavailable(error);
    }
  };
  try {
    releaseReady = props.view.onCommit(initialize);
    listeners.add(stopReady);
    initialize();
  } catch (error) {
    unavailable(error);
  }
  const ignoredActionIds = () => [
    ...(props.source.ignoreActionIds ?? []),
    ...mergeActions(ACTIONS, props.source.additionalActions)
      .filter((action) => !host.supports(action))
      .map((action) => action.id),
  ];
  return (
    <Show when={ready() && props.alive()}>
      <HostedFloatingTableMenu host={picker} canEdit={props.canEdit} />
      <HostedActionMenu
        {...props.source}
        ignoreActionIds={ignoredActionIds()}
        menu={props.menu}
        host={host}
      />
    </Show>
  );
}
