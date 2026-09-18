import { Telemetry } from '@macro-inc/observability';
import type { DictationTrace } from '../core/telemetry';

/** Recording and upload share a trace; capture no content or device identifiers. */
export function startDictationTrace(): DictationTrace {
  const span = Telemetry.span('dictation.session');
  return {
    event: (name, attributes) => span.event(`dictation.${name}`, attributes),
    run: (operation) => span.run(operation),
    end: (outcome) => {
      span.setAttr('dictation.outcome', outcome);
      if (outcome === 'microphone_error' || outcome === 'recording_error') {
        span.error(outcome);
      }
      span.end();
    },
  };
}
