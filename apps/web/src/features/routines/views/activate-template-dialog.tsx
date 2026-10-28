import CheckIcon from '@icon/system/regular/check.svg';
import LightningIcon from '@icon/system/regular/lightning.svg';
import UserIcon from '@icon/system/regular/user.svg';
import WarningIcon from '@icon/system/regular/warning-circle.svg';
import { ActionDialogShell, Badge, Button, Dialog, Item, Tabs } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import {
  TemplateReferenceChip,
  variableLabel,
} from '../components/template-reference';
import type { ReferenceChoice } from '../core/template';
import type { TemplateReference } from '../primitives/template-activation';

function decisionReason(reference: TemplateReference) {
  if (reference.state === 'choose') return 'Each person picks their own.';
  return reference.variable.kind === 'item' &&
    reference.variable.block_name === 'channel'
    ? "A channel you're not in."
    : "You can't open this.";
}

function DecisionRow(props: {
  reference: TemplateReference;
  choice: ReferenceChoice | undefined;
  onChoose(choice: ReferenceChoice): void;
}) {
  return (
    <Item variant="outlined" size="sm" class="flex-wrap">
      <Item.Content>
        <Item.Title>
          <TemplateReferenceChip
            variable={props.reference.variable}
            state={props.reference.state}
          />
        </Item.Title>
        <Item.Description>{decisionReason(props.reference)}</Item.Description>
      </Item.Content>
      <Item.Actions>
        <Tabs
          aria-label={`What to do with ${variableLabel(props.reference.variable)}`}
          size="sm"
          wrap
          options={[
            { value: 'keep' as const, label: 'Keep it' },
            { value: 'leave_out' as const, label: 'Leave out' },
          ]}
          value={props.choice}
          onChange={props.onChoose}
        />
      </Item.Actions>
    </Item>
  );
}

function Section(props: {
  icon: JSX.Element;
  title: string;
  children: JSX.Element;
}) {
  return (
    <section class="flex flex-col gap-2">
      <h3 class="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
        {props.icon}
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

/**
 * Activating a template: the routine as it will run for the viewer on the
 * left, and on the right the references they must decide on, what fills in
 * as them, and what works as it is.
 */
export function ActivateTemplateDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  name: string;
  authorName: string;
  triggers: readonly string[];
  /** The filled-in instructions, read-only. */
  instructions: JSX.Element;
  references: readonly TemplateReference[];
  choices: ReadonlyMap<string, ReferenceChoice>;
  onChoose(key: string, choice: ReferenceChoice): void;
  undecided: number;
  pending: boolean;
  error?: string;
  onActivate(): void;
}) {
  const byState = (...states: TemplateReference['state'][]) =>
    props.references.filter((reference) => states.includes(reference.state));
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      position="center"
      class="w-[min(64rem,calc(100vw-2rem))]"
      visibleScrim
    >
      <div class="contents">
        <ActionDialogShell hideBorder class="max-h-[85dvh] bg-transparent">
          <ActionDialogShell.Header class="flex flex-wrap items-center gap-2 space-y-0 border-b border-edge-divider px-5 py-3">
            <ActionDialogShell.Title class="text-base">
              Activate for me: {props.name}
            </ActionDialogShell.Title>
            <Badge variant="outline" size="xs">
              Template by {props.authorName}
            </Badge>
          </ActionDialogShell.Header>
          <div class="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[3fr_2fr]">
            <div class="flex flex-col gap-3 p-5">
              <h3 class="text-xs font-medium text-ink-muted">Your routine</h3>
              <For each={props.triggers}>
                {(trigger) => (
                  <div class="flex items-center gap-2 text-sm">
                    <LightningIcon class="size-4 shrink-0 text-ink-muted" />
                    {trigger}
                  </div>
                )}
              </For>
              {props.instructions}
            </div>
            <div class="flex flex-col gap-5 border-edge-divider p-5 md:border-l">
              <Show when={byState('unavailable', 'choose').length > 0}>
                <Section
                  icon={<WarningIcon class="size-3.5 text-warning" />}
                  title={`Your call · ${props.undecided} left`}
                >
                  <For each={byState('unavailable', 'choose')}>
                    {(reference) => (
                      <DecisionRow
                        reference={reference}
                        choice={props.choices.get(reference.key)}
                        onChoose={(choice) =>
                          props.onChoose(reference.key, choice)
                        }
                      />
                    )}
                  </For>
                </Section>
              </Show>
              <Section
                icon={<UserIcon class="size-3.5" />}
                title="Filled in as you"
              >
                <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt class="text-ink-muted">Runs as</dt>
                  <dd>You</dd>
                  <For each={byState('fills_in')}>
                    {(reference) => (
                      <>
                        <dt class="text-ink-muted">
                          {reference.variable.kind === 'time_zone'
                            ? 'Time zone'
                            : `Mentions of ${variableLabel(reference.variable)}`}
                        </dt>
                        <dd>
                          {reference.variable.kind === 'time_zone'
                            ? 'Yours'
                            : 'You'}
                        </dd>
                      </>
                    )}
                  </For>
                </dl>
              </Section>
              <Show when={byState('works').length > 0}>
                <Section
                  icon={<CheckIcon class="size-3.5 text-success" />}
                  title={`Works for you as is · ${byState('works').length}`}
                >
                  <div class="flex flex-wrap gap-2">
                    <For each={byState('works')}>
                      {(reference) => (
                        <TemplateReferenceChip
                          variable={reference.variable}
                          state={reference.state}
                        />
                      )}
                    </For>
                  </div>
                </Section>
              </Show>
            </div>
          </div>
          <ActionDialogShell.Footer class="justify-between">
            <p class="text-sm text-ink-muted" role="status">
              <Show
                when={props.error}
                fallback={
                  props.undecided > 0
                    ? `Decide on ${props.undecided} ${props.undecided === 1 ? 'reference' : 'references'} to activate.`
                    : 'Your routine runs as you, on its own schedule.'
                }
              >
                {(error) => <span class="text-failure">{error()}</span>}
              </Show>
            </p>
            <div class="flex gap-2">
              <Button
                variant="outline"
                onClick={() => props.onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                variant="cta"
                disabled={props.undecided > 0 || props.pending}
                onClick={() => props.onActivate()}
              >
                {props.pending ? 'Activating…' : 'Activate'}
              </Button>
            </div>
          </ActionDialogShell.Footer>
        </ActionDialogShell>
      </div>
    </Dialog>
  );
}
