import type { DocumentOp } from '@ai-ops/editor';
import { dispatchApplicationCommandNowIfSessionEdit } from '@core/component/LexicalMarkdown/plugins/group-b/command';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import type { InputSettlement } from '@macro-inc/lexical-wasm-view/view/port';
import type { JsonValue } from '@macro-inc/lexical-wasm-view/view/types';
import { type Span, Telemetry } from '@macro-inc/observability';
import { match, P } from 'ts-pattern';
import {
  createInvocationAllocator,
  type InvocationAllocator,
} from './invocation-allocator';

/** The closed native refusal causes (ai_ops.rs `AiOpRefusal`). */
const REFUSAL_CAUSES = [
  'unsupportedOp',
  'invalidNumber',
  'rangeTooLarge',
  'unknownNode',
  'wrongTarget',
  'findMissed',
  'splitsSurrogate',
] as const;
export type AiOpRefusalCause = (typeof REFUSAL_CAUSES)[number];

type Outcome =
  | { readonly kind: 'handled'; readonly handled: boolean }
  | { readonly kind: 'retired'; readonly reason: RetiredReason };
type RetiredReason = 'unmounted' | 'closed' | 'closing';

/** Optional telemetry never replaces the primary outcome. */
function record(write: () => void): void {
  try {
    write();
  } catch {
    /* Telemetry is best effort here; the edit's own outcome stands. */
  }
}

/** Per captured origin: its token allocator and whether it is applying. */
type OriginState = {
  readonly invocations: InvocationAllocator;
  applying: boolean;
};
const origins = new WeakMap<EditorView, OriginState>();

function originState(view: EditorView): OriginState {
  let state = origins.get(view);
  if (!state) {
    state = { invocations: createInvocationAllocator(), applying: false };
    origins.set(view, state);
  }
  return state;
}

/**
 * Source `applyAiOps` over the native session, in the caller's task: one
 * selection clear, then one admitted input per op. A refused op is skipped
 * and the ops after it still apply, as in the app's Source editor, whose
 * onError reports to telemetry instead of throwing; the refusal is reported
 * with its typed cause and no content, and the edit still succeeds.
 * `view` is the editor the popup captured; it is never retargeted.
 *
 * Owned retirement (the captured view unmounted before an entry, or the
 * session closed) drops the edit silently, as Source loses it on its detached
 * editor, with a typed span event. Losing Edit access is a named intentional
 * security difference: the prefix stays and the client reports failure. Every
 * other outcome throws.
 */
export function applyAiOpsNative(
  view: EditorView,
  ops: readonly DocumentOp[],
  span: Span
): void {
  // Not reentrant for the SAME origin: nested work in its drain cannot start a
  // second edit there. Other editors keep their own state and executor guard.
  const state = originState(view);
  if (state.applying)
    throw new Error('A native AI edit is already applying here');
  state.applying = true;
  try {
    run(view, ops, span, state);
  } finally {
    state.applying = false;
  }
}

function run(
  view: EditorView,
  ops: readonly DocumentOp[],
  span: Span,
  state: OriginState
): void {
  let refused = 0;
  const retired = (reason: RetiredReason) => {
    record(() =>
      span.event('ai_edit.dropped_retired_origin', {
        'ai_edit.retired_reason': reason,
        'ai_edit.op_count': ops.length,
      })
    );
  };
  const settle = (name: string, payload: () => JsonValue): Outcome => {
    // Owned retirement is decided before entry, never inferred from a failure.
    if (!view.isMounted) return { kind: 'retired', reason: 'unmounted' };
    const settlement: InputSettlement =
      dispatchApplicationCommandNowIfSessionEdit(view, name, payload);
    return match(settlement)
      .returnType<Outcome>()
      .with({ status: 'success' }, ({ handled }) => ({
        kind: 'handled',
        handled,
      }))
      .with(
        { status: 'cancelled', reason: P.union('closed', 'closing') },
        ({ reason }) => ({
          kind: 'retired',
          reason,
        })
      )
      .with({ status: 'cancelled', reason: 'session-access' }, () => {
        record(() =>
          span.event('ai_edit.access_lost', { 'ai_edit.op_count': ops.length })
        );
        throw new Error('AI edit lost Edit access');
      })
      .with({ status: 'cancelled', reason: 'entry-admission' }, () => {
        throw new Error('AI edit input was not admitted');
      })
      .with({ status: 'error' }, ({ error }) => {
        throw error;
      })
      .exhaustive();
  };

  const cleared = settle('group-c.ai-edit-clear-selection', () => ({}));
  if (cleared.kind === 'retired') {
    retired(cleared.reason);
    return;
  }
  if (!cleared.handled)
    throw new Error('AI edit selection clear was not handled');

  for (const [index, op] of ops.entries()) {
    // Allocated before entry; exhaustion throws before this op is dispatched.
    const invocation = state.invocations.next();
    let refusal: AiOpRefusalCause | 'invalid' | undefined;
    let refusals = 0;
    const stop = view.onPluginEvent('group-c.ai-op-refused', (payload) => {
      // Only this input's refusal counts; nested work carries other tokens.
      const own = match(payload)
        .with(
          { invocation: P.number },
          ({ invocation: token }) => token === invocation
        )
        .otherwise(() => false);
      if (!own) return;
      refusals++;
      refusal = match(payload)
        .with({ cause: P.union(...REFUSAL_CAUSES) }, ({ cause }) => cause)
        .otherwise(() => 'invalid' as const);
    });
    let outcome: Outcome;
    try {
      // No merge flag: undo grouping is the native history's port of Source's
      // rule (MergeTracker, and Loro's merge interval on the host clock, 400 ms
      // strict), across calls as well as within one.
      outcome = settle('group-c.ai-op', () => ({
        op: op as unknown as JsonValue,
        invocation,
      }));
    } finally {
      try {
        stop();
      } catch {
        /* Listener removal cannot replace this input's primary outcome. */
      }
    }
    if (outcome.kind === 'retired') {
      retired(outcome.reason);
      return;
    }
    if (outcome.handled) {
      if (refusals > 0)
        throw new Error(`AI op ${index} both applied and refused`);
      continue;
    }
    if (refusals !== 1 || refusal === undefined || refusal === 'invalid')
      throw new Error(`AI op ${index} unhandled without one typed refusal`);
    const cause = refusal;
    refused++;
    // Source reports the dropped op through the editor's onError
    // (Telemetry.error, error.source lexical, editor_type markdown-sync). The
    // native report carries the same fields, an engine discriminator Source
    // lacks, and the typed cause; never the op or document text.
    record(() =>
      Telemetry.error(new Error('AI op refused'), {
        'error.source': 'lexical',
        'lexical.editor_type': 'markdown-sync',
        'editor.engine': 'native',
        'ai_edit.refusal_index': index,
        'ai_edit.refusal_cause': cause,
      })
    );
    record(() => {
      span.event('ai_edit.op_refused', {
        'ai_edit.refusal_index': index,
        'ai_edit.refusal_cause': cause,
      });
    });
  }
  record(() => span.setAttr('edit.refused_count', refused));
}
