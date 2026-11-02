import { SearchBar } from '@app/components/view-shell/SearchBar';
import MagnifyingGlassIcon from '@icon/system/regular/magnifying-glass.svg';
import { Button } from '@ui';
import { createSignal, createUniqueId, Show } from 'solid-js';

export function ProjectTaskSearch(props: {
  projectName: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  const [expanded, setExpanded] = createSignal(Boolean(props.value));
  const inputId = createUniqueId();
  let trigger: HTMLButtonElement | undefined;
  const label = () => `Search in ${props.projectName}`;

  const close = () => {
    props.onValueChange('');
    setExpanded(false);
    queueMicrotask(() => trigger?.focus());
  };

  return (
    <Show
      when={expanded()}
      fallback={
        <Button
          aria-label={label()}
          tooltip={label()}
          ref={trigger}
          variant="secondary"
          size="icon-md"
          aria-expanded={false}
          aria-controls={inputId}
          onClick={() => setExpanded(true)}
        >
          <MagnifyingGlassIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
        </Button>
      }
    >
      <SearchBar
        id={inputId}
        ref={(input) => queueMicrotask(() => input.focus())}
        label={label()}
        placeholder={label()}
        class="h-8 w-56 shrink-0"
        value={props.value}
        onValueChange={props.onValueChange}
        onClose={close}
        onEscape={close}
      />
    </Show>
  );
}
