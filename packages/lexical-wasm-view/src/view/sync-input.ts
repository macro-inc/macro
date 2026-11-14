import {
  Access,
  type EditorInputMsg,
  FLAG_HANDLED,
  SessionInputMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import type {
  ExecutorCompletion,
  SessionExecutor,
  SyncEntrySchedule,
} from '@macro-inc/collaboration/session/executor';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import { Flag } from '@macro-inc/collaboration/session/output';
import type { EditorSession } from '@macro-inc/collaboration/session/wasm';
import type { NativeEnterBinding } from './native-enter-output';
import type { EditorPort, SyncInputOptions } from './port';

interface SyncInputContext {
  readonly port: EditorPort;
  readonly executor: Pick<SessionExecutor<EditorSession>, 'session' | 'now'> &
    Partial<Pick<SessionExecutor<EditorSession>, 'tryRunSync'>>;
  readonly commands?: NativeEnterBinding;
  readonly assertRootAdmission: () => void;
  readonly effectiveAccess: () => Access;
  /** Existing Enter/Escape/block-arrow event scope only, selected by SessionPort. */
  readonly invoke: (call: () => number) => number;
}

/** One scheduler and terminal holder for all root synchronous typed inputs. */
export function executeSyncInput<Proof>(
  context: SyncInputContext,
  factory: (
    policy: 'session-edit' | 'table-selection',
    generation: number
  ) => EditorInputMsg,
  options: SyncInputOptions<Proof>,
  admission: () => 'session-edit' | 'table-selection'
): SyncEntrySchedule {
  context.assertRootAdmission();
  const commands = context.commands;
  const session = context.executor.session;
  const run = context.executor.tryRunSync;
  if (!commands || !run)
    throw new Error('Owned synchronous input admission is unavailable');
  let ticket: object | undefined;
  let entryCompletion: ExecutorCompletion | undefined;
  let cleanupEntry:
    | { readonly ticket: object; readonly completion: ExecutorCompletion }
    | undefined;
  let terminal = false;
  let entered = false;
  let refused = false;
  let dispose: (() => void) | undefined;
  let current: (() => boolean) | undefined;
  let complete: SyncInputOptions<Proof>['after'] | undefined;
  let observation: SyncInputOptions<Proof>['observation'];
  let proof: { value: Proof } | undefined;
  let invalid = false;
  const live = () => !terminal && current?.() === true;
  const finish = () => {
    terminal = true;
    proof = undefined;
    const failures: { readonly error: unknown }[] = [];
    if (cleanupEntry) {
      const entry = cleanupEntry;
      cleanupEntry = undefined;
      try {
        commands.output.finishSyncCleanup(entry.ticket, entry.completion);
      } catch (error) {
        failures.push({ error });
      }
    }
    if (ticket) {
      try {
        commands.output.finishSyncInput(ticket);
      } catch (error) {
        failures.push({ error });
      }
    }
    const cleanup = dispose;
    dispose = undefined;
    try {
      cleanup?.();
    } catch (error) {
      failures.push({ error });
    }
    // The owned packet's code-2 effect is absorbed before the renderer in
    // syncEffects. Never drain a renderer-global bit here: an older legacy
    // entry may own it, and an access-refused entry owns no output at all.
    for (const failure of failures) {
      if (!entryCompletion) throw failure.error;
      commands.output.recordSyncCleanupFailure(entryCompletion, failure.error);
    }
  };
  const result = run.call(
    context.executor,
    (completion) => {
      entered = true;
      entryCompletion = completion;
      cleanupEntry = {
        ticket: commands.output.beginSyncCleanup(completion),
        completion,
      };
      const now = context.executor.now();
      const wall = Date.now();
      context.assertRootAdmission();
      if (context.executor.session !== session || context.commands !== commands)
        throw new Error('Synchronous input binding changed before entry');
      const view = options.view;
      const generation = options.generation;
      const alive = options.current;
      current = () =>
        context.executor.session === session &&
        context.commands === commands &&
        view.port === context.port &&
        view.isMounted &&
        view.mirror.keyGeneration === generation &&
        alive();
      if (!live()) throw new Error('Synchronous input view is not current');
      const policy = admission();
      if (policy !== 'session-edit' && policy !== 'table-selection')
        throw new Error('Unknown synchronous input policy');
      if (
        policy === 'session-edit' &&
        context.effectiveAccess() !== Access.Edit
      ) {
        refused = true;
        options.domRefused();
        return 0;
      }
      context.assertRootAdmission();
      if (!live())
        throw new Error('Synchronous input view changed during admission');
      complete = options.after;
      observation = options.observation;
      const eventName = observation?.name;
      const domEvent = options.domEvent;
      const eventPrototype =
        view.root.ownerDocument.defaultView?.Event.prototype;
      const preventDefault: unknown =
        eventPrototype &&
        Object.getOwnPropertyDescriptor(eventPrototype, 'preventDefault')
          ?.value;
      const stopPropagation: unknown =
        eventPrototype &&
        Object.getOwnPropertyDescriptor(eventPrototype, 'stopPropagation')
          ?.value;
      if (
        typeof preventDefault !== 'function' ||
        typeof stopPropagation !== 'function'
      )
        throw new Error(
          'Originating event realm has no DOM disposition methods'
        );
      commands.output.assertSyncCleanup(cleanupEntry.ticket, completion);
      ticket = commands.output.beginSyncInput(
        completion,
        (disposition) => {
          if (
            !live() ||
            !completion.running ||
            !ticket ||
            !commands.output.canDeliverSyncDisposition(ticket)
          )
            return;
          if (disposition.defaultPrevented)
            Reflect.apply(preventDefault, domEvent, []);
          if (disposition.propagationStopped)
            Reflect.apply(stopPropagation, domEvent, []);
        },
        eventName
      );
      if (observation) {
        const name = eventName;
        if (name === undefined) throw new Error('Missing observation name');
        const decode = observation.decode;
        dispose = view.onPluginEvent(name, (payload) => {
          if (
            !live() ||
            !ticket ||
            !commands.output.acceptSyncPluginEvent(ticket, payload)
          )
            return;
          const value = decode(payload);
          if (value === undefined || proof) {
            invalid = true;
            return;
          }
          proof = { value };
        });
      }
      context.assertRootAdmission();
      if (!live())
        throw new Error('Synchronous input view changed during observation');
      commands.output.assertSyncCleanup(cleanupEntry.ticket, completion);
      const input = factory(policy, generation);
      const bytes = SessionInputMsg.encode({
        ...emptyInput(2),
        editor: input,
      }).slice();
      context.assertRootAdmission();
      if (!live())
        throw new Error('Synchronous input view changed during preparation');
      commands.output.assertSyncCleanup(cleanupEntry.ticket, completion);
      // After actual input returns, preserve its real flags and drain its output
      // even if guard cleanup failed; capture refuses proof and finish reports it.
      const flags = context.invoke(() => session.input(bytes, now, wall));
      commands.output.captureSyncInput(ticket, flags);
      return flags;
    },
    (flags) => {
      if (refused || flags & Flag.Error || !live() || !ticket || invalid)
        return;
      const disposition = commands.output.consumeSyncInput(ticket, flags);
      if (!disposition) return;
      complete?.(Boolean(flags & FLAG_HANDLED), proof?.value, disposition);
    },
    finish
  );
  if (result.status === 'refused') {
    if (entered || result.reason !== 'busy-queued')
      throw new Error('Synchronous scheduling refused an entered operation');
  } else if (result.status !== 'completed' || !entered) {
    throw new Error('Synchronous scheduling returned no actual entry');
  }
  return result;
}
