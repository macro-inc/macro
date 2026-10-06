import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal, For } from 'solid-js';
import { Button } from './Button';
import { CollapseTransition } from './CollapseTransition';

// #region demo:disclosure
function DisclosureDemo() {
  const [open, setOpen] = createSignal(true);
  return (
    <div class="flex w-72 flex-col gap-2">
      <Button
        variant="outline"
        size="sm"
        class="self-start"
        aria-expanded={open()}
        onClick={() => setOpen((value) => !value)}
      >
        {open() ? 'Hide files' : 'Show files'}
      </Button>
      <CollapseTransition open={open()}>
        <ul class="flex flex-col gap-1 rounded-lg border border-edge-muted p-2 text-sm text-ink-muted">
          <For each={['README.md', 'justfile', 'Cargo.toml']}>
            {(name) => <li>{name}</li>}
          </For>
        </ul>
      </CollapseTransition>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'CollapseTransition',
  category: 'Layout',
  status: 'stable',
  description:
    'Animates a disclosure body open and closed along its height or width. Sidebar sections, tree branches, and tool groups share it. Externally sized panels can provide their resting size and companion animations for positioned neighbors.',
  exports: ['CollapseTransition'],
  import:
    "import { CollapseTransition } from '@ui/components/CollapseTransition';",
  demos: [
    { id: 'disclosure', title: 'Show and hide a body', render: DisclosureDemo },
  ],
});
