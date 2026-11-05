import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import BuildingsIcon from '@icon/system/regular/buildings.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import TableIcon from '@icon/system/regular/table.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, Checkbox, Dialog, Dropdown, EntityComposer, Panel } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { NewPipeline } from '../core/pipeline';

const RECORD_TYPES = [
  {
    value: 'company',
    icon: BuildingsIcon,
    get label() {
      return t('crm.pipelineTrackCompanies');
    },
  },
  {
    value: 'contact',
    icon: UsersIcon,
    get label() {
      return t('crm.pipelineTrackContacts');
    },
  },
  {
    value: 'generic',
    icon: TableIcon,
    get label() {
      return t('crm.pipelineTrackGeneric');
    },
  },
] as const;

type Tracking = (typeof RECORD_TYPES)[number]['value'];

/** One creation session; cancel preserves existing CRM data. */
export function PipelineDialog(props: {
  onCreate(input: NewPipeline): Promise<void>;
  onClose(): void;
}) {
  const [name, setName] = createSignal('');
  const [tracking, setTracking] = createSignal<Tracking>('company');
  const [shareWithTeam, setShareWithTeam] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal(false);
  const tracked = () =>
    RECORD_TYPES.find((type) => type.value === tracking()) ?? RECORD_TYPES[0];
  const close = () => !pending() && props.onClose();
  async function submit() {
    if (pending() || !name().trim()) return;
    setPending(true);
    setError(false);
    try {
      const current = tracking();
      await props.onCreate({
        name: name().trim(),
        recordType: current === 'generic' ? null : current,
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
              fireAndForget(submit(), 'crm');
            }}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                (event.metaKey || event.ctrlKey) &&
                !event.isComposing
              ) {
                event.preventDefault();
                event.stopPropagation();
                fireAndForget(submit(), 'crm');
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
                  variant="ghost"
                  tabIndex={-1}
                  aria-label="Close"
                  tooltip="Close"
                  size="icon-md"
                  disabled={pending()}
                  onClick={close}
                >
                  <XIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
                </Button>
              </EntityComposer.Header>
              <EntityComposer.Main class="gap-4">
                <EntityComposer.Properties class="px-2">
                  <Dropdown placement="bottom-start">
                    <Dropdown.Trigger
                      aria-label={t('crm.pipelineTrackChoice', {
                        choice: tracked().label,
                      })}
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
                        <Dropdown.GroupLabel>
                          {t('crm.pipelineTrack')}
                        </Dropdown.GroupLabel>
                        <Dropdown.RadioGroup
                          value={tracking()}
                          onChange={(value) => setTracking(value as Tracking)}
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
