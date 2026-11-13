import { Telemetry } from '@macro-inc/observability';
import {
  ABI_MAJOR,
  DIFF_FORMAT_VERSION,
  FLAG_HANDLED,
  type IViewEffectMsg,
  ViewEffectMsg,
} from './abi.generated';

export const Flag = {
  View: 1,
  Io: 2,
  WakeChanged: 4,
  NeedPeerIds: 8,
  Error: 16,
  Handled: FLAG_HANDLED,
} as const;
export interface Effect {
  tag: number;
  a: number;
  b: number;
  payload: Uint8Array;
}
/** Output owns its buffer; every payload stays valid across wasm memory growth. */
export function decodeOutput(bytes: Uint8Array) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const word = () => {
    if (at + 4 > bytes.byteLength) throw new Error('Truncated session output');
    const v = data.getUint32(at, true);
    at += 4;
    return v;
  };
  if (
    word() !== 0x4d534553 ||
    (word() & 0xffff) !== ABI_MAJOR ||
    word() !== DIFF_FORMAT_VERSION
  )
    throw new Error('AbiMismatch');
  const words = word(),
    strings = word(),
    count = word();
  const blob = (len: number) => {
    if (len > bytes.byteLength - at)
      throw new Error('Truncated session payload');
    const value = bytes.subarray(at, at + len);
    at += len;
    at = (at + 3) & ~3;
    if (at > bytes.byteLength) throw new Error('Missing session alignment');
    return value;
  };
  const viewBytes = blob(words * 4);
  const view = new Uint32Array(viewBytes.buffer, viewBytes.byteOffset, words);
  const text = blob(strings);
  const effects: Effect[] = [];
  const viewEffects: DecodedViewEffect[] = [];
  for (let i = 0; i < count; i++) {
    const tag = word(),
      a = word(),
      b = word(),
      len = word();
    const payload = blob(len);
    if (tag === 16) viewEffects.push(ViewEffectMsg.decode(payload));
    else effects.push({ tag, a, b, payload });
  }
  if (at !== bytes.byteLength) throw new Error('Trailing session output');
  return { view, strings: text, viewEffects, effects };
}

/** The original value a host code tokenizer threw, carried by the error effect reporting it. */
export interface CodeTokenCause {
  readonly value: unknown;
}
/** Anything that may carry a tokenizer throw for the current output only. */
export interface CodeTokenCauseCarrier {
  codeTokenCause?: CodeTokenCause;
}
/** A decoded view effect; an error effect may carry its tokenizer throw for this output only. */
export type DecodedViewEffect = IViewEffectMsg & CodeTokenCauseCarrier;

/** The per-call record of `EditorSession.takeCodeTokenFailure`. */
interface CodeTokenFailureRecord {
  readonly entry: bigint;
  effectOrdinals(): Uint32Array;
  causes(): Uint32Array;
  free(): void;
}
/** The `EditorSession` exports that hand recorded tokenizer throws back. */
interface CodeTokenCauseSource {
  takeCodeTokenFailure(): CodeTokenFailureRecord | undefined;
  takeCodeTokenCause(entry: bigint, cause: number): unknown[] | undefined;
}

/** Native carried exactly these pairs for this call; any gap breaks its contract. */
function reportBindingBreak(
  reason: 'no-effect' | 'no-cause-id' | 'take-missed',
  ordinal: number
): void {
  try {
    Telemetry.error(new Error('Code token cause binding broke its contract'), {
      surface: 'code-token-cause.binding',
      reason,
      ordinal,
    });
  } catch {
    // Reporting must not replace the session error.
  }
}

/**
 * Take the latest call's recorded code tokenizer throws and put each original value on the
 * error effect of THIS decoded output that reported it. Call only for a failure carrier, right after
 * takeOutput and before any other session call: the next call retires untaken values.
 */
export function bindCodeTokenCauses(
  session: CodeTokenCauseSource,
  effects: readonly CodeTokenCauseCarrier[]
): void {
  const failure = session.takeCodeTokenFailure();
  if (!failure) return;
  try {
    const ordinals = failure.effectOrdinals();
    const causes = failure.causes();
    ordinals.forEach((ordinal, index) => {
      const effect = effects[ordinal];
      const cause = causes[index];
      if (!effect) return reportBindingBreak('no-effect', ordinal);
      if (cause === undefined)
        return reportBindingBreak('no-cause-id', ordinal);
      const taken = session.takeCodeTokenCause(failure.entry, cause);
      if (taken?.length !== 1)
        return reportBindingBreak('take-missed', ordinal);
      effect.codeTokenCause = { value: taken[0] };
    });
  } finally {
    failure.free();
  }
}

/**
 * Attach the effect's tokenizer throw, if any, as the error's own `cause` without reading or
 * coercing it. The error is returned whether or not attaching succeeds.
 */
export function withCodeTokenCause<Raised extends Error>(
  error: Raised,
  effect: CodeTokenCauseCarrier
): Raised {
  const cause = effect.codeTokenCause;
  if (!cause) return error;
  try {
    Object.defineProperty(error, 'cause', {
      value: cause.value,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  } catch {
    // The error is still raised without its cause.
  }
  return error;
}

/** As `withCodeTokenCause`, only when exactly one of the effects carries a throw. */
export function withSingleCodeTokenCause<Raised extends Error>(
  error: Raised,
  effects: readonly CodeTokenCauseCarrier[]
): Raised {
  const carrying = effects.filter((effect) => effect.codeTokenCause);
  return carrying.length === 1 ? withCodeTokenCause(error, carrying[0]) : error;
}
