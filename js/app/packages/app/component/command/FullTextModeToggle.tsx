import { Switch } from '@kobalte/core/switch';
import { resetKonsoleMode, setKonsoleMode } from './state';

type Props = {
  checked: boolean;
};

export default function FullTextModeToggle(props: Props) {
  function handleChange(enabled: boolean) {
    enabled ? setKonsoleMode('FULL_TEXT_SEARCH') : resetKonsoleMode();
  }

  return (
    <div class="flex items-center gap-2 pr-3">
      <div class="font-mono font-bold text-ink-extra-muted text-xs uppercase">
        Full Text Search
      </div>
      <Switch checked={props.checked} onChange={handleChange}>
        <Switch.Input class="sr-only" />
        <Switch.Control class="inline-flex bg-edge border-2 border-transparent rounded-full focus-visible:outline-none hover:ring-1 hover:ring-edge focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 w-8 h-4 transition-colors data-[checked]:bg-accent-270">
          <Switch.Thumb class="block bg-dialog rounded-full w-3 h-3 transition-transform data-[checked]:translate-x-4" />
        </Switch.Control>
      </Switch>
    </div>
  );
}
