import type { Recorder } from './membrane';
import type { Fixture } from './schema';

export function fixture(
  recorder: Recorder,
  source: Fixture['source']
): Fixture {
  const last = [...recorder.editors.keys()].at(-1);
  const first = recorder.trace.find((op) => op.op === 'createEditor');
  return {
    schema: 2,
    source,
    tier: 'A-rec',
    partial: false,
    covers: [],
    normalize: [],
    outcomeDiffers: [],
    config: (first?.config as Fixture['config']) ?? {},
    initial: { editorState: null, selection: null },
    trace: recorder.trace,
    tapes: recorder.tapes,
    final: last ? recorder.snapshot(last) : null,
  };
}
