import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import { InputGroup } from '@ui';

export function ParticipantsSearchInput(props: {
  value: string;
  onInput: (value: string) => void;
}) {
  return (
    <InputGroup>
      <InputGroup.Input
        type="search"
        aria-label="Search participants"
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        placeholder="Search participants"
      />
      <InputGroup.Addon>
        <MagnifyingGlassIcon />
      </InputGroup.Addon>
      <InputGroup.Addon align="inline-end">
        <InputGroup.ClearButton />
      </InputGroup.Addon>
    </InputGroup>
  );
}
