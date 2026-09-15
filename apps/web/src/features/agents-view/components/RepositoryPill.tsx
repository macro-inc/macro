import { PILL_CLASS } from '@app/features/block-agent/component/ModelPicker';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import GitBranchIcon from '@phosphor/git-branch.svg';
import PlusIcon from '@phosphor/plus.svg';
import XIcon from '@phosphor/x.svg';
import { Button, cn, Dialog, Dropdown, Panel } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { parseRepositoryInput, repositoryLabel } from '../core/repository';

/**
 * Which repository the coder works in. Optional: without one the session
 * runs against the workspace alone. Recent picks lead; anything else is
 * typed in as `owner/repo` or a URL.
 */
export function RepositoryPill(props: {
  value: string | undefined;
  recent: string[];
  disabled?: boolean;
  onSelect: (url: string | undefined) => void;
  onForget: (url: string) => void;
}) {
  const [adding, setAdding] = createSignal(false);

  return (
    <>
      <Dropdown placement="bottom-start">
        <Dropdown.Trigger
          variant="outline"
          size="sm"
          class={cn(PILL_CLASS, !props.value && 'text-ink-subtle')}
          aria-label="Repository"
          disabled={props.disabled}
          tooltip={props.value ? 'Repository' : 'Repository (optional)'}
        >
          <GitBranchIcon class="size-3.5 shrink-0" />
          <span class={cn('min-w-0 truncate', props.value && 'text-ink')}>
            {props.value ? repositoryLabel(props.value) : 'Add repository'}
          </span>
          <CaretDownIcon class="size-3 shrink-0 text-current/70" />
        </Dropdown.Trigger>
        <Dropdown.Content class="w-72 max-w-[min(24rem,calc(100vw-1rem))]">
          <Dropdown.Group class="max-h-72 overflow-y-auto overscroll-contain">
            <Dropdown.GroupLabel>Repository</Dropdown.GroupLabel>
            <Dropdown.Item
              class={cn(
                'h-8 gap-2',
                !props.value && 'bg-ink/5 font-medium text-ink'
              )}
              onSelect={() => props.onSelect(undefined)}
            >
              <span class="min-w-0 flex-1 truncate text-sm">No repository</span>
              <span class="shrink-0 text-xs text-ink-extra-muted">
                workspace only
              </span>
              <Show when={!props.value}>
                <CheckIcon class="size-3.5 shrink-0 text-accent" />
              </Show>
            </Dropdown.Item>
            <Show when={props.recent.length > 0}>
              <Dropdown.GroupLabel>Recent</Dropdown.GroupLabel>
              <For each={props.recent}>
                {(url) => (
                  <Dropdown.Item
                    class={cn(
                      'group h-8 gap-2',
                      props.value === url && 'bg-ink/5 font-medium text-ink'
                    )}
                    onSelect={() => props.onSelect(url)}
                  >
                    <GitBranchIcon class="size-3.5 shrink-0 text-ink-muted" />
                    <span class="min-w-0 flex-1 truncate text-sm" title={url}>
                      {repositoryLabel(url)}
                    </span>
                    <Show
                      when={props.value === url}
                      fallback={
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          label={`Forget ${repositoryLabel(url)}`}
                          class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            props.onForget(url);
                          }}
                        >
                          <XIcon />
                        </Button>
                      }
                    >
                      <CheckIcon class="size-3.5 shrink-0 text-accent" />
                    </Show>
                  </Dropdown.Item>
                )}
              </For>
            </Show>
          </Dropdown.Group>
          <Dropdown.Separator class="my-1 h-px bg-edge-muted" />
          <Dropdown.Item class="h-8 gap-2" onSelect={() => setAdding(true)}>
            <PlusIcon class="size-3.5 shrink-0" />
            <span class="min-w-0 flex-1 truncate text-sm">Add repository…</span>
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown>
      <Show when={adding()}>
        <AddRepositoryDialog
          onClose={() => setAdding(false)}
          onAdd={(url) => {
            props.onSelect(url);
            setAdding(false);
          }}
        />
      </Show>
    </>
  );
}

function AddRepositoryDialog(props: {
  onClose: () => void;
  onAdd: (url: string) => void;
}) {
  const [text, setText] = createSignal('');
  const [touched, setTouched] = createSignal(false);
  const parsed = () => parseRepositoryInput(text());
  const invalid = () => touched() && text().trim().length > 0 && !parsed();

  const submit = () => {
    const url = parsed();
    setTouched(true);
    if (url) props.onAdd(url);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      position="center"
      visibleScrim
      class="w-[min(440px,calc(100vw-16px))]"
    >
      <Panel depth={2} class="rounded-xl text-ink">
        <Panel.Header class="justify-between px-4 py-3">
          <Dialog.Title class="text-sm font-semibold">
            Add repository
          </Dialog.Title>
          <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
            <XIcon />
          </Dialog.CloseButton>
        </Panel.Header>
        <Panel.Body class="flex flex-col gap-2 p-4">
          <label class="flex flex-col gap-1.5">
            <span class="text-xs font-medium text-ink">Repository</span>
            <input
              autofocus
              autocomplete="off"
              spellcheck={false}
              aria-invalid={invalid() || undefined}
              class="settings-input w-full font-mono text-xs"
              placeholder="owner/repo or https://github.com/owner/repo"
              value={text()}
              onInput={(event) => {
                setTouched(false);
                setText(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          </label>
          <p
            class={cn(
              'text-xs',
              invalid() ? 'text-negative' : 'text-ink-extra-muted'
            )}
          >
            {invalid()
              ? 'That does not look like a repository. Try owner/repo or a full URL.'
              : 'The coder clones it into its sandbox for this session.'}
          </p>
        </Panel.Body>
        <Panel.Footer class="justify-end gap-2 px-4 py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={props.onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="cta"
            size="sm"
            disabled={!parsed()}
            onClick={submit}
          >
            Add repository
          </Button>
        </Panel.Footer>
      </Panel>
    </Dialog>
  );
}
