import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { ResultAsync } from 'neverthrow';
import { type Accessor, createSignal } from 'solid-js';
import { loadNaturalTimeWasm, type NaturalTimeWasmModule } from './wasm-module';

/** The natural_time reader as it loads. A failed load is tried again by the next caller. */
export type NaturalTimeState =
  | { status: 'loading' }
  | { status: 'ready'; reader: NaturalTimeWasmModule }
  | { status: 'failed' };

/** Starts loading the reader, without suspending while it loads. */
export function createNaturalTime(): Accessor<NaturalTimeState> {
  const [state, setState] = createSignal<NaturalTimeState>({
    status: 'loading',
  });
  fireAndForget(loadInto(setState), 'natural-time');
  return state;
}

async function loadInto(setState: (state: NaturalTimeState) => void) {
  const loaded = await ResultAsync.fromPromise(
    loadNaturalTimeWasm(),
    (error) => error
  );
  if (loaded.isErr()) {
    Telemetry.error(loaded.error, { surface: 'natural-time' });
    setState({ status: 'failed' });
    return;
  }
  setState({ status: 'ready', reader: loaded.value });
}
