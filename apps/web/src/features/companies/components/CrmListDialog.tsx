import { Button, Dialog, Panel } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';

/** Mounted for one editing session so cancel never changes the stored collection. */
export function CrmListDialog(props: {
  initial?: { id: string; name: string; companyIds: string[] };
  companies: { id: string; name: string }[];
  loading: boolean;
  onSave: (name: string, ids: string[]) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = createSignal(props.initial?.name ?? '');
  const [search, setSearch] = createSignal('');
  const [ids, setIds] = createSignal(props.initial?.companyIds ?? []);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  const filtered = createMemo(() =>
    props.companies.filter((c) =>
      c.name.toLowerCase().includes(search().toLowerCase())
    )
  );
  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (pending() || !name().trim()) return;
    setPending(true);
    try {
      await props.onSave(name().trim(), ids());
      props.onClose();
    } catch {
      setError('Could not save this list. Please try again.');
    } finally {
      setPending(false);
    }
  }
  async function remove() {
    if (pending() || !props.onDelete) return;
    setPending(true);
    try {
      await props.onDelete();
      props.onClose();
    } catch {
      setError('Could not delete this list. Please try again.');
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !pending() && props.onClose()}
      class="w-112 max-w-[calc(100vw-2rem)]"
    >
      <Panel>
        <Panel.Body>
          <form class="flex flex-col gap-4 p-5" onSubmit={save}>
            <Dialog.Title class="text-base font-semibold">
              {props.initial ? 'Edit list' : 'New list'}
            </Dialog.Title>
            <Dialog.Description class="text-sm text-ink-muted">
              A personal collection. Add companies without changing their stage
              or owner.
            </Dialog.Description>
            <label class="flex flex-col gap-1.5 text-sm">
              List name
              <input
                required
                maxlength={100}
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                placeholder="e.g. Design partners"
                class="rounded-lg border border-edge-muted bg-input px-3 py-2 outline-none focus:border-accent"
              />
            </label>
            <input
              aria-label="Find companies for list"
              placeholder="Find companies…"
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
              class="rounded-lg border border-edge-muted bg-input px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <div class="max-h-64 overflow-auto">
              <For each={filtered()}>
                {(company) => (
                  <label class="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-hover">
                    <input
                      type="checkbox"
                      checked={ids().includes(company.id)}
                      disabled={pending()}
                      onChange={(e) =>
                        setIds((current) =>
                          e.currentTarget.checked
                            ? [...current, company.id]
                            : current.filter((id) => id !== company.id)
                        )
                      }
                    />
                    <span class="truncate">{company.name}</span>
                  </label>
                )}
              </For>
              <Show when={!filtered().length}>
                <p class="py-3 text-sm text-ink-muted">
                  {props.loading
                    ? 'Loading companies…'
                    : 'No matching companies'}
                </p>
              </Show>
            </div>
            <p class="text-xs text-ink-muted">
              {ids().length} selected · Browse up to 500 recent companies
            </p>
            <Show when={error()}>
              <p role="alert" class="text-sm text-failure">
                {error()}
              </p>
            </Show>
            <div class="flex items-center gap-2">
              <Show when={props.onDelete}>
                <Button
                  variant="ghost"
                  disabled={pending()}
                  onClick={() => void remove()}
                >
                  Delete list
                </Button>
              </Show>
              <Button
                variant="ghost"
                class="ml-auto"
                disabled={pending()}
                onClick={props.onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="accent"
                disabled={pending() || !name().trim()}
              >
                {pending() ? 'Saving…' : 'Save list'}
              </Button>
            </div>
          </form>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
