import CaretDown from '@phosphor/caret-down.svg';
import CaretLeft from '@phosphor/caret-left.svg';
import CaretRight from '@phosphor/caret-right.svg';
import Check from '@phosphor/check.svg';
import { Button } from '@ui/components/Button';
import { Dialog } from '@ui/components/Dialog';
import { Input } from '@ui/components/Input';
import { Panel } from '@ui/components/Panel';
import { createSignal, For, Show } from 'solid-js';

export type ReviewSummary = {
  id: string;
  title: string;
  description: string;
  status: string;
  needsAttention: boolean;
};

export function ReviewNavigation(props: {
  title: string;
  items: ReviewSummary[];
  index: number;
  disabled: boolean;
  onNavigate: (index: number) => Promise<void>;
}) {
  const [open, setOpen] = createSignal(false);
  const [search, setSearch] = createSignal('');
  const visible = () => {
    const query = search().trim().toLocaleLowerCase();
    return props.items
      .map((item, index) => ({ ...item, index }))
      .filter((item) =>
        `${item.title} ${item.description} ${item.status}`
          .toLocaleLowerCase()
          .includes(query)
      );
  };
  async function choose(index: number) {
    await props.onNavigate(index);
    setOpen(false);
  }
  function openPicker() {
    setSearch('');
    setOpen(true);
  }

  return (
    <>
      <header class="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1">
        <h3 class="min-w-0 text-sm font-medium text-ink">{props.title}</h3>
        <nav
          aria-label="Draft navigation"
          class="ml-auto flex shrink-0 items-center gap-0.5"
        >
          <Button
            size="icon-sm"
            label="Previous draft"
            disabled={props.disabled || props.index === 0}
            onClick={() => void props.onNavigate(props.index - 1)}
          >
            <CaretLeft />
          </Button>
          <Button
            size="sm"
            label={`Choose draft, ${props.index + 1} of ${props.items.length}`}
            aria-haspopup="dialog"
            aria-expanded={open()}
            disabled={props.disabled}
            onClick={openPicker}
          >
            <span class="tabular-nums">
              {props.index + 1} of {props.items.length}
            </span>
            <CaretDown class="size-3" />
          </Button>
          <Button
            size="icon-sm"
            label="Next draft"
            disabled={props.disabled || props.index === props.items.length - 1}
            onClick={() => void props.onNavigate(props.index + 1)}
          >
            <CaretRight />
          </Button>
        </nav>
      </header>
      <Dialog
        open={open()}
        onOpenChange={setOpen}
        position="center"
        class="w-120 max-w-full"
      >
        <Panel depth={2} class="rounded-xl">
          <Panel.Header class="justify-between gap-3 px-4">
            <Dialog.Title class="text-sm font-medium text-ink">
              {props.title}
            </Dialog.Title>
          </Panel.Header>
          <Panel.Body class="flex min-h-0 flex-col gap-3 p-3">
            <Dialog.Description class="sr-only">
              Choose a draft to review or edit.
            </Dialog.Description>
            <Input
              aria-label="Search drafts"
              placeholder="Search drafts…"
              value={search()}
              onInput={(event) => setSearch(event.currentTarget.value)}
            />
            <div class="max-h-80 overflow-y-auto" aria-label="Drafts">
              <For
                each={visible()}
                fallback={
                  <p role="status" class="p-3 text-sm text-ink-muted">
                    No matching drafts.
                  </p>
                }
              >
                {(item) => (
                  <Button
                    fullWidth
                    class="h-auto min-h-14 justify-start gap-3 rounded-lg px-3 py-2 text-left whitespace-normal touch:min-h-14"
                    aria-current={
                      item.index === props.index ? 'true' : undefined
                    }
                    disabled={props.disabled}
                    onClick={() => void choose(item.index)}
                  >
                    <span class="w-4 shrink-0 text-xs tabular-nums text-ink-muted">
                      <Show
                        when={item.index === props.index}
                        fallback={item.index + 1}
                      >
                        <Check class="size-4" />
                      </Show>
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block text-sm font-medium text-ink wrap-anywhere">
                        {item.title}
                      </span>
                      <span class="block text-xs font-normal text-ink-muted wrap-anywhere">
                        {item.description}
                      </span>
                    </span>
                    <span
                      class="shrink-0 text-xs font-normal text-ink-muted"
                      classList={{ 'text-failure': item.needsAttention }}
                    >
                      {item.status}
                    </span>
                  </Button>
                )}
              </For>
            </div>
          </Panel.Body>
          <Panel.Footer class="justify-end p-3">
            <Button size="sm" onClick={() => setOpen(false)}>
              Done
            </Button>
          </Panel.Footer>
        </Panel>
      </Dialog>
    </>
  );
}
