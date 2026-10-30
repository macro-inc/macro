import BracketsIcon from '@phosphor/brackets-curly.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import { Dropdown, Input, TextField } from '@ui';
import {
  type Component,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import type { ToolStepDraft } from '../core/routine-steps';
import {
  priorityOptions,
  retarget,
  type StepScope,
  senderPolicies,
  statusOptions,
  stepActionKey,
  stepTarget,
  stepTargets,
  TRIGGER_ID,
  triggerFields,
} from '../core/step-catalog';

export type TagChoice = {
  definitionId: string;
  optionId: string;
  label: string;
};

/** Data-backed pickers, injected by the app so the editor stays query-free. */
export type RoutineToolSlots = {
  LabelPicker: Component<{ value: string; onChange(label: string): void }>;
  TagPicker: Component<{
    /** The selected tag option's id. */
    value: string | undefined;
    onChange(tag: TagChoice): void;
  }>;
  ChannelPicker: Component<{
    value: string;
    onChange(channelId: string): void;
  }>;
  AssigneePicker: Component<{
    value: string | undefined;
    onChange(entityId: string, name: string): void;
  }>;
  FolderPicker: Component<{
    value: string | undefined;
    onChange(projectId: string): void;
  }>;
};

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/**
 * Where a step menu mounts: on the creator's dialog when inside one, so the
 * composer's scrolling panel can't clip it; the local scope otherwise.
 */
export function menuMount(trigger: HTMLElement | undefined) {
  return trigger?.closest<HTMLElement>('[role="dialog"]') ?? undefined;
}

/** Pick one of a few fixed options. */
export function OptionMenu(props: {
  label: string;
  value: unknown;
  options: readonly { id: string; label: string }[];
  onChange(id: string): void;
}) {
  let trigger: HTMLButtonElement | undefined;
  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger ref={trigger} aria-label={props.label} class="gap-1.5">
        {props.options.find((option) => option.id === props.value)?.label ??
          'Choose…'}
        <CaretDownIcon class="size-3" />
      </Dropdown.Trigger>
      <Dropdown.Content portalScope="local" mount={menuMount(trigger)}>
        <Dropdown.Group>
          <For each={props.options}>
            {(option) => (
              <Dropdown.Item onSelect={() => props.onChange(option.id)}>
                {option.label}
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

/** Insert `{{…}}` fields from the triggering item and earlier steps. */
function FieldMenu(props: { scope: StepScope; onInsert(value: string): void }) {
  const fields = () => [
    ...triggerFields(props.scope.subject),
    ...props.scope.outputs,
  ];
  let trigger: HTMLButtonElement | undefined;
  return (
    <Show when={fields().length}>
      <Dropdown placement="bottom-end">
        <Dropdown.Trigger
          ref={trigger}
          variant="ghost"
          size="icon-sm"
          aria-label="Insert a field"
          title="Insert a field from the triggering item or an earlier step"
        >
          <BracketsIcon class="size-3.5" />
        </Dropdown.Trigger>
        <Dropdown.Content portalScope="local" mount={menuMount(trigger)}>
          <Dropdown.Group>
            <Dropdown.GroupLabel>Insert field</Dropdown.GroupLabel>
            <For each={fields()}>
              {(field) => (
                <Dropdown.Item onSelect={() => props.onInsert(field.value)}>
                  {field.label}
                </Dropdown.Item>
              )}
            </For>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
}

/** Text that may embed `{{…}}` fields. */
function TemplateField(props: {
  label: string;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  scope: StepScope;
  onChange(value: string): void;
}) {
  const insert = (field: string) => {
    const value = props.value;
    props.onChange(
      value && !value.endsWith(' ') ? `${value} ${field}` : `${value}${field}`
    );
  };
  return (
    <TextField value={props.value} onChange={props.onChange} class="grid gap-1">
      <div class="flex items-center justify-between gap-2">
        <TextField.Label class="text-xs text-ink-muted">
          {props.label}
        </TextField.Label>
        <FieldMenu scope={props.scope} onInsert={insert} />
      </div>
      <Show
        when={props.multiline}
        fallback={<TextField.Input placeholder={props.placeholder} />}
      >
        <TextField.TextArea
          autoResize
          rows={2}
          placeholder={props.placeholder}
        />
      </Show>
    </TextField>
  );
}

export function Row(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex flex-wrap items-center gap-2 text-sm">
      <span class="text-xs text-ink-muted">{props.label}</span>
      {props.children}
    </div>
  );
}

/** Raw arguments for tool steps the catalog has no form for. */
function ArgumentsEditor(props: {
  step: ToolStepDraft;
  onChange(step: ToolStepDraft): void;
}) {
  const [draft, setDraft] = createSignal(
    JSON.stringify(props.step.arguments, null, 2)
  );
  const [error, setError] = createSignal<string>();
  const commit = () => {
    try {
      const value: unknown = JSON.parse(draft());
      if (typeof value !== 'object' || value === null || Array.isArray(value))
        throw new Error('Arguments must be a JSON object.');
      setError(undefined);
      props.onChange({
        ...props.step,
        arguments: value as Record<string, unknown>,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invalid JSON.');
    }
  };
  return (
    <TextField
      value={draft()}
      onChange={setDraft}
      validationState={error() ? 'invalid' : 'valid'}
      class="grid gap-1"
    >
      <TextField.Label class="text-xs text-ink-muted">
        {props.step.tool} arguments
      </TextField.Label>
      <TextField.TextArea
        autoResize
        rows={3}
        class="font-mono text-xs"
        onBlur={commit}
      />
      <TextField.ErrorMessage>{error()}</TextField.ErrorMessage>
    </TextField>
  );
}

/** Choose which item a step acts on, when it could act on several. */
export function TargetRow(props: {
  step: ToolStepDraft;
  scope: StepScope;
  onChange(step: ToolStepDraft): void;
}) {
  const targets = () => stepTargets(props.step, props.scope);
  const current = () => stepTarget(props.step);
  // Acting on anything but the triggering item is worth spelling out.
  const visible = () => targets().length > 1 || current() !== TRIGGER_ID;
  return (
    <Show when={targets().length && visible()}>
      <Row label="On">
        <OptionMenu
          label="Item"
          value={current()}
          options={targets().map((item) => ({
            id: item.ref,
            label: item.label,
          }))}
          onChange={(ref) => {
            const item = targets().find((item) => item.ref === ref);
            if (item) props.onChange(retarget(props.step, item));
          }}
        />
      </Row>
    </Show>
  );
}

/**
 * The picker for a step's one value: a label, tag, status, priority or
 * person. `name` is what the value is called, e.g. a tag's or person's name.
 */
export function ActionValue(props: {
  step: ToolStepDraft;
  slots: RoutineToolSlots;
  onChange(patch: Record<string, unknown>, name: string): void;
}) {
  const args = () => props.step.arguments;
  const key = () => stepActionKey(props.step);
  const tagId = () => {
    const [optionId] = Array.isArray(args().add_option_ids)
      ? (args().add_option_ids as unknown[])
      : [];
    return typeof optionId === 'string' ? optionId : undefined;
  };
  const assignee = () => {
    const [ref] = Array.isArray(args().entity_refs)
      ? (args().entity_refs as { entityId?: unknown }[])
      : [];
    return typeof ref?.entityId === 'string' ? ref.entityId : undefined;
  };
  const fixed = (options: readonly { id: string; label: string }[]) => (
    <OptionMenu
      label={key() === 'set_status' ? 'Status' : 'Priority'}
      value={args().option_id}
      options={options}
      onChange={(option_id) =>
        props.onChange(
          { option_id },
          options.find((option) => option.id === option_id)?.label ?? ''
        )
      }
    />
  );
  return (
    <Switch>
      <Match when={key() === 'add_label' || key() === 'remove_label'}>
        <props.slots.LabelPicker
          value={text(args().label)}
          onChange={(label) => props.onChange({ label }, label)}
        />
      </Match>
      <Match when={key() === 'add_tag'}>
        <props.slots.TagPicker
          value={tagId()}
          onChange={(tag) =>
            props.onChange(
              {
                property_definition_id: tag.definitionId,
                add_option_ids: [tag.optionId],
              },
              tag.label
            )
          }
        />
      </Match>
      <Match when={key() === 'set_status'}>{fixed(statusOptions)}</Match>
      <Match when={key() === 'set_priority'}>{fixed(priorityOptions)}</Match>
      <Match when={key() === 'assign'}>
        <props.slots.AssigneePicker
          value={assignee()}
          onChange={(entityId, name) =>
            props.onChange(
              { entity_refs: [{ entityType: 'user', entityId }] },
              name
            )
          }
        />
      </Match>
    </Switch>
  );
}

const valueLabels: Partial<Record<ReturnType<typeof stepActionKey>, string>> = {
  add_label: 'Label',
  remove_label: 'Label',
  add_tag: 'Tag',
  set_status: 'Status',
  set_priority: 'Priority',
  assign: 'Assign to',
};

/** The form for one tool step, chosen by the action it was built from. */
export function ToolStepBody(props: {
  step: ToolStepDraft;
  onChange(step: ToolStepDraft): void;
  slots: RoutineToolSlots;
  scope: StepScope;
}) {
  const args = () => props.step.arguments;
  const set = (patch: Record<string, unknown>) =>
    props.onChange({
      ...props.step,
      arguments: { ...props.step.arguments, ...patch },
    });
  const key = () => stepActionKey(props.step);
  return (
    <div class="grid gap-3">
      <TargetRow
        step={props.step}
        scope={props.scope}
        onChange={props.onChange}
      />
      <Switch>
        <Match when={valueLabels[key()]}>
          {(label) => (
            <Row label={label()}>
              <ActionValue
                step={props.step}
                slots={props.slots}
                onChange={(patch) => set(patch)}
              />
            </Row>
          )}
        </Match>
        <Match when={key() === 'sender_policy'}>
          <Row label="Treat future mail from this sender as">
            <OptionMenu
              label="Sender policy"
              value={args().policy}
              options={senderPolicies}
              onChange={(policy) => set({ policy })}
            />
          </Row>
        </Match>
        <Match when={key() === 'move'}>
          <Row label="Folder">
            <props.slots.FolderPicker
              value={text(args().projectId) || undefined}
              onChange={(projectId) => set({ projectId })}
            />
          </Row>
        </Match>
        <Match when={key() === 'create_task' || key() === 'create_document'}>
          <TemplateField
            label="Title"
            value={text(args().documentName)}
            placeholder={key() === 'create_task' ? 'Follow up' : 'Daily brief'}
            scope={props.scope}
            onChange={(documentName) => set({ documentName })}
          />
          <TemplateField
            label={key() === 'create_task' ? 'Description' : 'Content'}
            value={text(args().fileContent)}
            placeholder="Optional details"
            multiline
            scope={props.scope}
            onChange={(fileContent) => set({ fileContent })}
          />
        </Match>
        <Match when={key() === 'send_message'}>
          <Row label="Channel">
            <props.slots.ChannelPicker
              value={text(args().channel_id)}
              onChange={(channel_id) => set({ channel_id })}
            />
          </Row>
          <TemplateField
            label="Message"
            value={text(args().content)}
            placeholder="New invoice from {{trigger.email.from.name}}"
            multiline
            scope={props.scope}
            onChange={(content) => set({ content })}
          />
        </Match>
        <Match when={key() === 'comment' || key() === 'reply_in_thread'}>
          <TemplateField
            label={key() === 'comment' ? 'Comment' : 'Reply'}
            value={text(args().content)}
            multiline
            scope={props.scope}
            onChange={(content) => set({ content })}
          />
        </Match>
        <Match when={key() === 'other'}>
          <ArgumentsEditor step={props.step} onChange={props.onChange} />
        </Match>
      </Switch>
    </div>
  );
}

/** A compact input for free text, e.g. a label name. */
export function TextChoice(props: {
  label: string;
  value: string;
  placeholder: string;
  suggestions?: string[];
  onChange(value: string): void;
}) {
  const listId = `routine-${props.label.toLowerCase().replace(/\W+/g, '-')}-${crypto.randomUUID()}`;
  return (
    <>
      <Input
        aria-label={props.label}
        size="sm"
        class="w-48"
        value={props.value}
        placeholder={props.placeholder}
        list={props.suggestions?.length ? listId : undefined}
        onChange={(event) => props.onChange(event.currentTarget.value.trim())}
      />
      <Show when={props.suggestions?.length}>
        <datalist id={listId}>
          <For each={props.suggestions}>
            {(suggestion) => <option value={suggestion} />}
          </For>
        </datalist>
      </Show>
    </>
  );
}
