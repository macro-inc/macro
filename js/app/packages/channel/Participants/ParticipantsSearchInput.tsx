import MagnifyingGlassIcon from '@icon/regular/magnifying-glass.svg';

export function ParticipantsSearchInput(props: {
  value: string;
  onInput: (value: string) => void;
}) {
  return (
    <div class="flex items-center gap-2 w-full border border-edge rounded-sm px-4 py-2">
      <MagnifyingGlassIcon class="size-4 text-ink-muted shrink-0" />
      <input
        type="text"
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        placeholder="Search"
        class="flex-1 min-w-0 text-sm bg-surface border-none outline-none text-ink placeholder:text-ink-placeholder"
      />
    </div>
  );
}
