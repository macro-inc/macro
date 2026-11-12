import Warning from '@icon/system/regular/warning.svg';

/**
 * Why a prompt did not run: the agent may not run on its registered runtime.
 * A system line in the transcript, like a session event, but never truncated:
 * the reason is the whole message.
 */
export function RuntimeRefusalRow(props: { reason: string }) {
  return (
    <div
      role="status"
      class="flex min-w-0 items-start gap-2 py-1 text-xs text-failure"
      data-runtime-refusal
    >
      <Warning aria-hidden="true" class="mt-px size-4 shrink-0" />
      <span class="min-w-0 flex-1">{props.reason}</span>
    </div>
  );
}
