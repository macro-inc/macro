import { TextField } from '@ui';

/** The event title field shared by full and embedded event composers. */
export function EventTitleInput(props: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autofocus?: boolean;
}) {
  return (
    <TextField
      class="w-full"
      value={props.value}
      onChange={props.onChange}
      disabled={props.disabled}
    >
      <TextField.TextArea
        variant="title"
        rows={1}
        autoResize
        submitOnEnter
        placeholder="New event"
        aria-label="Title"
        autofocus={props.autofocus}
      />
    </TextField>
  );
}
