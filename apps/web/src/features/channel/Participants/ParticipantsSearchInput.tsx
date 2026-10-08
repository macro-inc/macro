import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import { InputGroup } from '@ui';

export function ParticipantsSearchInput(props: {
  value: string;
  placeholder?: string;
  embedded?: boolean;
  onInput: (value: string) => void;
}) {
  return (
    <InputGroup
      size="lg"
      variant={props.embedded ? 'bare' : 'outline'}
      class={props.embedded ? 'h-full rounded-none border-0' : 'rounded-full'}
    >
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
      <InputGroup.Addon
        align="inline-end"
        class={props.embedded ? 'pe-6!' : undefined}
      >
        <InputGroup.ClearButton />
      </InputGroup.Addon>
    </InputGroup>
  );
}
