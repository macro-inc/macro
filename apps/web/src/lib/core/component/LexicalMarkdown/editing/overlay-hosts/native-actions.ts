import { enableDatabases, isFeatureEnabled } from '@core/constant/featureFlags';
import { fireAndForget } from '@core/util/fireAndForget';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { Telemetry } from '@macro-inc/observability';
import { ACTIONS } from '../../plugins/actions/actions';
import type { Action, ActionContext } from '../../plugins/actions/types';
import {
  dispatchApplicationCommandIfSessionEdit,
  dispatchApplicationCommandSettled,
  dispatchApplicationCommandSettledIfSessionEdit,
  queryApplication,
} from '../../plugins/group-b/command';
import type { ActionMenuHost } from './actions';
import { createNativeListenerScope } from './native-listeners';

export interface NativeActionRequests {
  requestTable(): void | Promise<void>;
  openFileDialog?: (kind: 'all') => boolean;
  requestGif?: () => boolean;
  requestEquation?: () => void;
  requestLink?: () => void;
  /** Reports the real composer open request, before any placeholder admission. */
  requestCreation?: (
    kind: 'task' | 'document',
    context?: ActionContext
  ) => boolean;
  additionalActions?: ReadonlyMap<
    Action,
    (context?: ActionContext) => void | Promise<void>
  >;
}

const blockKinds = new Map([
  ['paragraph', 'paragraph'],
  ['heading1', 'heading1'],
  ['heading2', 'heading2'],
  ['heading3', 'heading3'],
  ['quote', 'quote'],
  ['code', 'code'],
  ['list-bullet', 'list-bullet'],
  ['list-number', 'list-number'],
  ['list-check', 'list-check'],
]);

/** Catalog classes supply dependency names; the native registry owns availability. */
export function createNativeActionMenuHost(
  view: EditorView,
  requests: NativeActionRequests,
  alive: () => boolean
): ActionMenuHost & { supports(action: Action): boolean; dispose(): void } {
  let disposed = false;
  const rootListeners = new Set<() => void>();
  const active = () => !disposed && alive() && view.isMounted;
  const hasDependencies: ActionMenuHost['hasDependencies'] = (dependencies) => {
    if (!active()) return false;
    const result = queryApplication(view, 'group-a.action-dependencies', {
      types: dependencies.map((dependency) => dependency.getType()),
    });
    if (
      typeof result !== 'object' ||
      result === null ||
      !('available' in result) ||
      typeof result.available !== 'boolean'
    ) {
      throw new Error('Invalid native action dependency response');
    }
    return result.available;
  };
  const supports = (item: Action) => {
    if (!active()) return false;
    if (typeof requests.additionalActions?.get(item) === 'function')
      return true;
    if (!ACTIONS.includes(item)) return false;
    if (
      blockKinds.has(item.id) ||
      item.id === 'hr' ||
      item.id === 'database-query'
    )
      return true;
    switch (item.id) {
      case 'table':
        return typeof requests.requestTable === 'function';
      case 'image':
      case 'video':
        return typeof requests.openFileDialog === 'function';
      case 'gif':
        return typeof requests.requestGif === 'function';
      case 'latex':
        return typeof requests.requestEquation === 'function';
      case 'link':
        return typeof requests.requestLink === 'function';
      case 'task':
      case 'document':
        return typeof requests.requestCreation === 'function';
      default:
        return false;
    }
  };
  const command = async (
    name: string,
    payload: string | Record<string, never>,
    current: () => boolean
  ) => {
    if (!current()) return;
    const result = await dispatchApplicationCommandSettled(view, name, payload);
    if (result.status === 'error') throw result.error;
  };
  const run = async (
    item: Action,
    current: () => boolean,
    context?: ActionContext
  ) => {
    const additional = requests.additionalActions?.get(item);
    if (additional) {
      await additional(context);
      return;
    }
    if (!ACTIONS.includes(item)) {
      throw new Error(
        'Native action handler is unavailable for this catalog item'
      );
    }
    const block = blockKinds.get(item.id);
    if (block) {
      await command('group-b.node-transform', block, current);
      return;
    }
    if (item.id === 'hr') {
      await command('group-b.horizontal-rule', {}, current);
      return;
    }
    if (
      (item.id === 'task' || item.id === 'document') &&
      requests.requestCreation
    ) {
      requests.requestCreation(item.id, context);
      return;
    }
    // Source Query checks the shared flag before scheduling its insertion update.
    if (item.id === 'database-query' && !isFeatureEnabled(enableDatabases))
      return;
    const requestContext = Telemetry.captureContext();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    if (!current()) return;
    return requestContext.run(async () => {
      if (item.id === 'database-query') {
        const result = await dispatchApplicationCommandSettledIfSessionEdit(
          view,
          'group-b.database-query-insert',
          () => ({}),
          { admit: current }
        );
        if (result.status === 'error') throw result.error;
        // Cancellation ends this action without a replacement input or success claim.
        return;
      } else if (item.id === 'table') {
        await requests.requestTable();
      } else if (
        (item.id === 'image' || item.id === 'video') &&
        requests.openFileDialog
      ) {
        requests.openFileDialog('all');
      } else if (item.id === 'gif' && requests.requestGif) {
        requests.requestGif();
      } else if (item.id === 'latex' && requests.requestEquation) {
        requests.requestEquation();
      } else if (item.id === 'link' && requests.requestLink) {
        requests.requestLink();
      } else {
        throw new Error(`Native action capability is unavailable: ${item.id}`);
      }
    });
  };
  const select = async (
    item: Action | undefined,
    origin: 'pointer' | 'keyboard',
    context?: ActionContext
  ) => {
    if (!active() || (item && !supports(item))) return;
    const span = Telemetry.span('editor.action');
    span.setAttr('action.id', item?.id ?? 'none');
    span.setAttr('action.origin', origin);
    if (context?.sourceDocumentId)
      span.setAttr('document.id', context.sourceDocumentId);
    try {
      const generation = view.mirror.keyGeneration;
      const current = () =>
        active() && view.mirror.keyGeneration === generation;
      const removal = await span.run(() =>
        dispatchApplicationCommandSettled(view, 'group-a.search-remove', {})
      );
      if (removal.status === 'error') throw removal.error;
      if (removal.status === 'cancelled' || !current() || !item) return;
      if (
        origin === 'pointer' &&
        item.dependencies &&
        !hasDependencies(item.dependencies)
      ) {
        console.error('Dispatched Action with missing dependencies:', item);
        return;
      }
      if (!current()) return;
      await span.run(() => run(item, current, context));
    } catch (error) {
      span.error(error);
      throw error;
    } finally {
      span.end();
    }
  };
  return {
    supports,
    root: () => (active() ? view.root : null),
    subscribeRoot(listener) {
      rootListeners.add(listener);
      try {
        listener();
      } catch (error) {
        rootListeners.delete(listener);
        throw error;
      }
      return () => rootListeners.delete(listener);
    },
    hasDependencies,
    closeSearch() {
      // Closing the UI writes only under current session edit access.
      if (active())
        dispatchApplicationCommandIfSessionEdit(
          view,
          'group-a.search-close',
          {}
        );
    },
    select(item, origin, context) {
      fireAndForget(select(item, origin, context), 'native-action-menu');
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const listeners = createNativeListenerScope();
      for (const listener of rootListeners) listeners.add(listener);
      rootListeners.clear();
      listeners.dispose();
    },
  };
}
