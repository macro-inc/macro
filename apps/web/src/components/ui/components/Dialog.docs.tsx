import { defineDoc } from '@app/features/ui-gallery/types';
import { isMobile } from '@core/mobile/isMobile';
import { createSignal, createUniqueId, For } from 'solid-js';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Input } from './Input';
import { Panel } from './Panel';

// #region demo:pinned-actions
function PinnedActionsDemo() {
  const [open, setOpen] = createSignal(false);
  const formId = createUniqueId();
  const actions = () => (
    <div class="flex justify-end gap-2">
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      <Button type="submit" form={formId}>
        Save
      </Button>
    </div>
  );
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open form</Button>
      <Dialog
        open={open()}
        onOpenChange={setOpen}
        position="center"
        class={isMobile() ? undefined : 'w-118'}
      >
        <Panel
          depth={2}
          class={isMobile() ? undefined : 'max-h-[85dvh] rounded-xl'}
        >
          <Panel.Header class="px-5">
            <Dialog.Title>Test form</Dialog.Title>
          </Panel.Header>
          <Panel.Body scroll={!isMobile()} class="p-5">
            <form
              id={formId}
              class="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                setOpen(false);
              }}
            >
              <For each={Array.from({ length: 16 }, (_, index) => index + 1)}>
                {(number) => (
                  <label class="grid gap-1 text-sm">
                    Field {number}
                    <Input placeholder="Test content" />
                  </label>
                )}
              </For>
            </form>
          </Panel.Body>
          <Dialog.Footer class="justify-end px-5 py-3">
            {actions()}
          </Dialog.Footer>
        </Panel>
      </Dialog>
    </>
  );
}
// #endregion

export default defineDoc({
  name: 'Dialog',
  category: 'Overlays',
  description:
    'Accessible dialogs become standard drawers on phones. Optional drawer actions remain outside scrolling content.',
  status: 'stable',
  import: "import { Dialog, Panel } from '@ui';",
  exports: ['Dialog'],
  propTypes: ['DialogProps'],
  demos: [
    {
      id: 'pinned-actions',
      title: 'Form with pinned actions',
      description:
        'Dialog.Footer stays in the desktop panel and is pinned below the phone drawer body; the submit button targets its form by id.',
      render: PinnedActionsDemo,
    },
  ],
});
