import BuildingsIcon from '@phosphor/buildings.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import UsersIcon from '@phosphor/users.svg';
import XIcon from '@phosphor/x.svg';
import { Button, Checkbox, Dialog, Dropdown, EntityComposer, Panel } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { NewPipeline } from '../core/pipeline';

const RECORD_TYPES = [
  { value: 'company', label: 'Companies', icon: BuildingsIcon },
  { value: 'contact', label: 'Contacts', icon: UsersIcon },
] as const;

/** One creation session; cancel preserves existing CRM data. */
export function PipelineDialog(props: {
  onCreate(input: NewPipeline): Promise<void>;
  onClose(): void;
}) {
  const [name, setName] = createSignal('');
  const [recordType, setRecordType] =
    createSignal<NewPipeline['recordType']>('company');
  const [shareWithTeam, setShareWithTeam] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal(false);
  const tracked = () =>
    RECORD_TYPES.find((type) => type.value === recordType()) ?? RECORD_TYPES[0];
  const close = () => !pending() && props.onClose();
  async function submit() {
    if (pending() || !name().trim()) return;
    setPending(true);
    setError(false);
    try {
      await props.onCreate({
        name: name().trim(),
        recordType: recordType(),
        sharing: shareWithTeam() ? 'team' : 'private',
      });
      props.onClose();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <Panel hideBorder class="bg-transparent rounded-[inherit] *:max-h-[75vh]">
        <Panel.Body>
          <form
            class="h-full min-h-0"
            aria-label="New pipeline"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                (event.metaKey || event.ctrlKey) &&
                !event.isComposing
              ) {
                event.preventDefault();
                event.stopPropagation();
                void submit();
              }
            }}
          >
            <EntityComposer.Root>
              <EntityComposer.Header>
                <Dialog.Title class="sr-only">New pipeline</Dialog.Title>
                <EntityComposer.Title class="mb-0 min-w-0 flex-1 self-center">
                  <input
                    autofocus
                    aria-label="Pipeline name"
                    placeholder="Pipeline name"
                    maxlength={200}
                    required
                    class="ph-no-capture w-full min-w-0 text-xl/7 font-medium outline-none bg-transparent placeholder:text-ink-placeholder"
                    value={name()}
                    disabled={pending()}
                    onInput={(event) => setName(event.currentTarget.value)}
                  />
                </EntityComposer.Title>
                <Button
                  tabIndex={-1}
                  aria-label="Close"
                  tooltip="Close"
                  size="icon-composer"
                  disabled={pending()}
                  onClick={close}
                >
                  <XIcon />
                </Button>
              </EntityComposer.Header>
              <EntityComposer.Main class="gap-4">
                <EntityComposer.Properties class="px-2">
                  <Dropdown placement="bottom-start">
                    <Dropdown.Trigger
                      aria-label={`Track ${tracked().label}`}
                      class="rounded-full"
                      disabled={pending()}
                    >
                      <Dynamic
                        component={tracked().icon}
                        class="size-3 shrink-0"
                      />
                      {tracked().label}
                      <CaretDownIcon class="size-3 shrink-0 text-ink-muted" />
                    </Dropdown.Trigger>
                    <Dropdown.Content class="min-w-40">
                      <Dropdown.Group>
                        <Dropdown.GroupLabel>Track</Dropdown.GroupLabel>
                        <Dropdown.RadioGroup
                          value={recordType()}
                          onChange={(value) =>
                            setRecordType(value as NewPipeline['recordType'])
                          }
                        >
                          <For each={RECORD_TYPES}>
                            {(type) => (
                              <Dropdown.RadioItem
                                value={type.value}
                                closeOnSelect
                              >
                                <Dynamic
                                  component={type.icon}
                                  class="size-4 shrink-0"
                                />
                                <span class="flex-1">{type.label}</span>
                                <Dropdown.ItemIndicator>
                                  <CheckIcon class="size-3.5 text-accent" />
                                </Dropdown.ItemIndicator>
                              </Dropdown.RadioItem>
                            )}
                          </For>
                        </Dropdown.RadioGroup>
                      </Dropdown.Group>
                    </Dropdown.Content>
                  </Dropdown>
                </EntityComposer.Properties>
              </EntityComposer.Main>
              <Show when={error()}>
                <p role="alert" class="px-2 text-sm text-failure">
                  Could not create this pipeline. Please try again.
                </p>
              </Show>
              <EntityComposer.Footer class="items-center">
                <Checkbox
                  checked={shareWithTeam()}
                  disabled={pending()}
                  onChange={setShareWithTeam}
                >
                  <Checkbox.Control />
                  <Checkbox.Label class="text-xs text-ink-muted font-normal whitespace-nowrap">
                    Share with my team
                  </Checkbox.Label>
                </Checkbox>
                <EntityComposer.Submit
                  type="submit"
                  class="ml-auto"
                  hasContent={Boolean(name().trim())}
                  disabled={pending() || !name().trim()}
                >
                  {pending() ? 'Creating…' : 'Create pipeline'}
                </EntityComposer.Submit>
              </EntityComposer.Footer>
            </EntityComposer.Root>
          </form>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
