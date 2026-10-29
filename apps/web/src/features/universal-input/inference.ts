import { type Span, Telemetry } from '@macro-inc/observability';
import { universalInputClient } from '@service-agent-harness/universal-input';
import { UniversalInputRequestError } from '@service-agent-harness/universal-input-error';
import {
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_OPTIONS,
} from '../next-soup/core/search-options';
import type { InputCapabilities } from './context/capabilities';
import type { InputPhase } from './context/telemetry';
import { type InputFailure, InputInferenceError } from './core/failure';
import type { Intent } from './core/input';
import { suggestionsSchema } from './core/input';
import { extractedSearchFields } from './queries/extracted-search';

export function createInferenceSource(
  properties: () => Promise<
    { name: string; options: string[] }[]
  > = async () => [],
  surface: 'command-menu' | 'mobile-search' = 'command-menu',
  parent?: () => Span | undefined
): Pick<InputCapabilities, 'classify' | 'extract'> & { dispose(): void } {
  const active = new Set<Span>();
  let disposed = false;
  const run = <T>(
    phase: InputPhase,
    text: string,
    revision: number,
    intent: Intent | undefined,
    operation: (span: Span) => Promise<T>
  ) => {
    if (disposed) return Promise.reject(new InputInferenceError('unavailable'));
    const span =
      parent?.()?.span(`universal_input.${phase}`) ??
      Telemetry.span(`universal_input.${phase}`);
    active.add(span);
    span.setAttr('input.surface', surface);
    span.setAttr('input.length', text.length);
    span.setAttr('input.revision', revision);
    if (intent) span.setAttr('input.intent', intent);
    return span.run(async () => {
      try {
        return await operation(span);
      } catch (failure) {
        const kind =
          failure instanceof InputInferenceError
            ? failure.kind
            : requestFailure(failure);
        span.setAttr('error.type', kind);
        span.error(`Universal Input ${phase} failed: ${kind}`);
        throw new InputInferenceError(kind);
      } finally {
        active.delete(span);
        span.end();
      }
    });
  };
  return {
    dispose() {
      disposed = true;
      for (const span of active) span.end();
      active.clear();
    },
    classify: (text, revision) =>
      run('classify', text, revision, undefined, (span) =>
        universalInputClient.classify(text, revision, span)
      ),
    extract: (text, intent, revision, searchType) =>
      run('extract', text, revision, intent, async (span) => {
        const catalog =
          intent === 'task'
            ? await (async () => {
                const catalogSpan = span.span('universal_input.catalog');
                active.add(catalogSpan);
                try {
                  return await catalogSpan.run(properties);
                } catch {
                  catalogSpan.setAttr('error.type', 'catalog');
                  catalogSpan.error('Task catalog unavailable');
                  throw new InputInferenceError('catalog');
                } finally {
                  active.delete(catalogSpan);
                  catalogSpan.end();
                }
              })()
            : intent === 'search'
              ? [
                  {
                    name: 'Status',
                    options: TASK_STATUS_OPTIONS.map((option) => option.label),
                  },
                  {
                    name: 'Priority',
                    options: TASK_PRIORITY_OPTIONS.map(
                      (option) => option.label
                    ),
                  },
                ]
              : [];
        if (disposed) throw new InputInferenceError('unavailable');
        const response = await universalInputClient.extract(
          text,
          intent,
          revision,
          catalog,
          searchType,
          span
        );
        let fields: unknown = response.suggestions;
        if (response.intent === 'search') {
          fields = extractedSearchFields(response.suggestions);
        } else if (response.intent === 'calendar') {
          const recurrence = response.suggestions.recurrence;
          fields = {
            ...response.suggestions,
            recurrence: recurrence
              ? {
                  frequency: recurrence.frequency,
                  interval: recurrence.interval,
                  byDay: recurrence.by_day,
                  monthlyByDay: recurrence.monthly_by_day ?? undefined,
                  ends: recurrence.ends,
                }
              : null,
          };
        }
        const decoded = suggestionsSchema.safeParse(fields);
        if (!decoded.success) throw new InputInferenceError('invalid_response');
        return {
          revision: response.revision,
          intent: response.intent,
          suggestions: decoded.data,
        };
      }),
  };
}

function requestFailure(error: unknown): InputFailure {
  if (!(error instanceof UniversalInputRequestError)) return 'unknown';
  switch (error.code) {
    case 'NETWORK_ERROR':
      return 'network';
    case 'TIMEOUT':
      return 'timeout';
    case 'UNAUTHORIZED':
      return 'unauthorized';
    case 'FORBIDDEN':
      return 'forbidden';
    case 'ALLOWANCE_EXHAUSTED':
      return 'allowance';
    case 'RATE_LIMITED':
      return 'rate_limit';
    case 'UNAVAILABLE':
    case 'SERVER_ERROR':
      return 'unavailable';
    case 'INVALID_REQUEST':
      return 'invalid_request';
    case 'INVALID_JSON':
    case 'INVALID_RESPONSE':
      return 'invalid_response';
    default:
      return 'unknown';
  }
}
