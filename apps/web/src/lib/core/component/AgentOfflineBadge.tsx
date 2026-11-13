/**
 * Marks an agent whose paired runtime is not connected. One component so the
 * composer picker, the mobile picker, and the `@` menu all say the same word
 * for the same state. A Macro computer that is off says "Powered off".
 */
export function AgentOfflineBadge(props: { label?: string }) {
  return (
    <span class="inline-flex shrink-0 items-center rounded-sm bg-hover px-1.5 py-0.5 text-[10px] font-medium leading-none text-ink-muted">
      {props.label ?? 'Offline'}
    </span>
  );
}
