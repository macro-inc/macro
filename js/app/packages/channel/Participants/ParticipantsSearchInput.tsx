export function ParticipantsSearchInput(props: {
  value: string;
  onInput: (value: string) => void;
}) {
  return (
    <input
      value={props.value}
      onInput={(event) => props.onInput(event.currentTarget.value)}
      placeholder="Search participants"
      class="h-10 w-full rounded-sm border border-edge-muted bg-surface px-3 text-sm text-ink placeholder:text-ink-muted focus:outline-none"
    />
  );
}
