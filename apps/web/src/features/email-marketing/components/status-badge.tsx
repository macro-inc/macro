export function StatusBadge(props: { status: string }) {
  const label = () =>
    props.status === 'needs_attention'
      ? 'Needs attention'
      : props.status.charAt(0).toUpperCase() + props.status.slice(1);
  return (
    <span
      class="inline-flex items-center gap-1.5 rounded-full bg-panel px-2.5 py-1 text-xs font-medium"
      classList={{
        'text-success':
          props.status === 'active' || props.status === 'scheduled',
        'text-warning':
          props.status === 'paused' || props.status === 'preparing',
        'text-failure': props.status === 'needs_attention',
        'text-ink-muted': ['draft', 'stopped', 'archived'].includes(
          props.status
        ),
      }}
    >
      <span class="size-1.5 rounded-full bg-current" />
      {label()}
    </span>
  );
}
