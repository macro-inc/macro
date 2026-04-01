export function ParticipantsEmptyState(props: { searchQuery: string }) {
  return (
    <div class="flex min-h-[240px] items-center justify-center border-b border-edge-muted/50 px-4 text-center text-sm text-ink-muted">
      {props.searchQuery.trim().length > 0
        ? `No participants match "${props.searchQuery}".`
        : 'No participants found.'}
    </div>
  );
}
