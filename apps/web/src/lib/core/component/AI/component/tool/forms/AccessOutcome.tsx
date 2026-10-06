import { MutationResult } from '@service-cognition/generated/tools/schemas';
import { Show } from 'solid-js';
import { MutationDetails } from './ResultDetails';
import type { FormMutation } from './types';

/** The session fold retains the inner UserAction result verbatim. */
export function FormAccessOutcome(props: { result: unknown }) {
  const outcome = () => {
    const parsed = MutationResult.safeParse(props.result);
    // The generated oneOf refinements validate enum fields at runtime, but
    // their inferred Zod type is wider than the generated Rust DTO type.
    return parsed.success ? (parsed.data as FormMutation) : undefined;
  };
  return (
    <Show
      when={outcome()}
      fallback={
        <p class="text-sm text-ink-muted">
          The sharing result could not be read. Ask the agent to inspect the
          form before retrying.
        </p>
      }
    >
      {(result) => <MutationDetails result={result()} />}
    </Show>
  );
}
