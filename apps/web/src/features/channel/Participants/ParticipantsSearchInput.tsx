import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import { InputGroup } from '@ui';

export function ParticipantsSearchInput(props: {
  value: string;
  placeholder?: string;
  onInput: (value: string) => void;
}) {
  return (
    <InputGroup size="lg" class="rounded-full">
      <InputGroup.Addon>
        <MagnifyingGlassIcon />
      </InputGroup.Addon>
      <InputGroup.Input
        type="search"
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        placeholder={props.placeholder ?? 'Search participants'}
        aria-label={props.placeholder ?? 'Search participants'}
      />
    </InputGroup>
  );
}
