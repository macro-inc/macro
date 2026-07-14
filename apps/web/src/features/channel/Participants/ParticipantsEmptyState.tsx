export function ParticipantsEmptyState(props: { searchQuery: string }) {
  return (
    <div class="flex min-h-60 items-center justify-center border-b border-edge-muted px-4 text-center text-sm text-ink-muted">
      {props.searchQuery.trim().length > 0
        ? `No participants match "${props.searchQuery}".`
        : 'No participants found.'}
    </div>
  );
}
