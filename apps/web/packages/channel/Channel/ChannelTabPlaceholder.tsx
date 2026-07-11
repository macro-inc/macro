export function ChannelTabPlaceholder(props: { label: string }) {
  return (
    <div class="flex min-h-0 flex-1 justify-center px-3 pb-3 pt-2">
      <div class="flex min-h-0 w-full max-w-channel-message flex-1 items-center justify-center rounded-md border border-dashed border-edge-muted bg-surface-1 px-4 py-8 text-sm text-ink-muted">
        {props.label} view is not implemented yet.
      </div>
    </div>
  );
}
