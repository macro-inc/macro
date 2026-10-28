import ArrowsClockwiseIcon from '@icon/system/regular/arrows-clockwise.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import LockIcon from '@icon/system/regular/lock-simple.svg';
import type {
  RoutineTemplate,
  TemplateVariable,
  VariableFill,
} from '@service-scheduled-action/generated/schemas';
import {
  ActionDialogShell,
  Badge,
  Button,
  Card,
  Dialog,
  Input,
  Tabs,
} from '@ui';
import { For, type JSX, Show } from 'solid-js';
import {
  TemplateReferenceChip,
  variableLabel,
} from '../components/template-reference';
import { variableKey } from '../core/template';

function fillOptions(variable: TemplateVariable) {
  if (variable.kind === 'time_zone')
    return [
      { value: 'activator' as const, label: 'Their time zone' },
      { value: 'shared' as const, label: `Keep ${variable.timezone}` },
    ];
  return [
    ...(variable.kind === 'user'
      ? [{ value: 'activator' as const, label: 'The person activating' }]
      : []),
    { value: 'shared' as const, label: 'Same for everyone' },
    { value: 'choice' as const, label: 'They choose' },
  ];
}

function VariableRow(props: {
  variable: TemplateVariable;
  disabled: boolean;
  onFill(fill: VariableFill): void;
}) {
  return (
    <div class="flex flex-wrap items-center justify-between gap-2 py-1.5">
      <TemplateReferenceChip
        variable={props.variable}
        state={props.variable.fill === 'activator' ? 'fills_in' : 'works'}
      />
      <Tabs
        aria-label={`How ${variableLabel(props.variable)} fills in`}
        size="sm"
        wrap
        disabled={props.disabled}
        options={fillOptions(props.variable)}
        value={props.variable.fill}
        onChange={props.onFill}
      />
    </div>
  );
}

function ShareNote(props: { icon: JSX.Element; children: JSX.Element }) {
  return (
    <li class="flex gap-2 text-sm text-ink-muted">
      <span class="mt-0.5 shrink-0">{props.icon}</span>
      <span>{props.children}</span>
    </li>
  );
}

/**
 * Sharing a routine as a template: the owner generalizes its references,
 * publishes the snapshot, and passes the link on. Their routine itself is
 * never shared.
 */
export function ShareTemplateDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  name: string;
  /** `undefined` while loading, `null` when not shared yet. */
  template: RoutineTemplate | null | undefined;
  description: string;
  onDescription(description: string): void;
  variables: readonly TemplateVariable[];
  onFill(key: string, fill: VariableFill): void;
  pending: boolean;
  error?: string;
  onShare(): void;
  onUnshare(): void;
  onCopyLink(): void;
  /** Posts the template to a channel or person; shown once it's shared. */
  send: JSX.Element;
}) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      position="center"
      class="w-[min(40rem,calc(100vw-2rem))]"
      visibleScrim
    >
      <div class="contents">
        <ActionDialogShell hideBorder class="max-h-[85dvh] bg-transparent">
          <ActionDialogShell.Body class="flex flex-col gap-5 space-y-0">
            <ActionDialogShell.Header class="flex flex-wrap items-center gap-2 space-y-0">
              <ActionDialogShell.Title class="text-base">
                Share: {props.name}
              </ActionDialogShell.Title>
              <Badge variant="outline" size="xs">
                As a template
              </Badge>
            </ActionDialogShell.Header>
            <Card>
              <Card.Body>
                <p class="font-medium">
                  People get a template, not your routine
                </p>
                <ul class="mt-2 flex flex-col gap-1.5">
                  <ShareNote icon={<CheckIcon class="size-4 text-success" />}>
                    They see your instructions and triggers, and can activate
                    their own copy that runs as them.
                  </ShareNote>
                  <ShareNote icon={<LockIcon class="size-4" />}>
                    Your routine, its runs and its results stay private to you.
                  </ShareNote>
                  <ShareNote icon={<ArrowsClockwiseIcon class="size-4" />}>
                    Sharing again updates the template with your routine's
                    current setup.
                  </ShareNote>
                </ul>
              </Card.Body>
            </Card>
            <label class="flex flex-col gap-1.5 text-sm">
              <span class="font-medium">Description</span>
              <Input
                value={props.description}
                placeholder="What does this routine do for someone?"
                maxLength={1000}
                disabled={props.pending}
                onInput={(event) =>
                  props.onDescription(event.currentTarget.value)
                }
              />
            </label>
            <Show when={props.variables.length > 0}>
              <section class="flex flex-col gap-1">
                <h3 class="text-sm font-medium">
                  What changes for each person
                </h3>
                <div class="divide-y divide-edge-divider">
                  <For each={props.variables}>
                    {(variable) => (
                      <VariableRow
                        variable={variable}
                        disabled={props.pending}
                        onFill={(fill) =>
                          props.onFill(variableKey(variable), fill)
                        }
                      />
                    )}
                  </For>
                </div>
              </section>
            </Show>
            <Show when={props.template}>
              {(template) => (
                <section class="flex flex-col gap-2">
                  <h3 class="text-sm font-medium">
                    Shared · active for {template().active_count}
                  </h3>
                  {props.send}
                </section>
              )}
            </Show>
            <Show when={props.error}>
              <p class="text-sm text-failure" role="alert">
                {props.error}
              </p>
            </Show>
          </ActionDialogShell.Body>
          <ActionDialogShell.Footer class="justify-between">
            <Show when={props.template} fallback={<span />}>
              <div class="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => props.onCopyLink()}>
                  <LinkIcon />
                  Copy template link
                </Button>
                <Button
                  variant="danger"
                  disabled={props.pending}
                  onClick={() => props.onUnshare()}
                >
                  Stop sharing
                </Button>
              </div>
            </Show>
            <Button
              variant="cta"
              disabled={props.pending || props.template === undefined}
              onClick={() => props.onShare()}
            >
              {props.template ? 'Update template' : 'Share template'}
            </Button>
          </ActionDialogShell.Footer>
        </ActionDialogShell>
      </div>
    </Dialog>
  );
}
