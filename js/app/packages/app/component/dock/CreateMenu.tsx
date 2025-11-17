import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import MacroCreateIcon from '@macro-icons/macro-create-b.svg';
import { Launcher } from './Launcher';

export const [createMenuOpen, setCreateMenuOpen] = createControlledOpenSignal();

export const toggleCreateMenu = () => {
  const isOpen = createMenuOpen();
  setCreateMenuOpen(!isOpen);
};

export function CreateMenu() {
  return (
    <>
      <button
        onClick={() => setCreateMenuOpen(true)}
        class="relative flex justify-between items-center gap-2 data-expanded:bg-accent data-expanded:border-accent **:border-none! font-medium text-ink-muted data-expanded:text-default-bg hover:text-accent text-base bracket-never"
        classList={{
          'bg-accent text-default-bg': createMenuOpen(),
        }}
      >
        <span class="flex items-center">
          <MacroCreateIcon
            class={`h-2.5 ${createMenuOpen() ? 'fill-dialog/70' : 'fill-accent/70 transition-all duration-300'}`}
          />
        </span>
      </button>
      <Launcher open={createMenuOpen()} onOpenChange={setCreateMenuOpen} />
    </>
  );
}
