/** The event title field shared by full and embedded event composers. */
export function EventTitleInput(props: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autofocus?: boolean;
}) {
  return (
    <input
      type="text"
      value={props.value}
      onInput={(event) => props.onChange(event.currentTarget.value)}
      placeholder="New event"
      aria-label="Title"
      autofocus={props.autofocus}
      disabled={props.disabled}
      class="h-9 w-full bg-transparent px-2 text-lg font-semibold leading-snug text-ink outline-none placeholder:text-ink-placeholder"
    />
  );
}
