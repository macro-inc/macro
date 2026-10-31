import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { cn, Dropdown, Tabs, TextField } from '@ui';
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
  stepActions,
  stepTarget,
  stepTargets,
  TRIGGER_ID,
} from '../core/step-catalog';
import { FieldText } from './routine-field-text';
import { menuMount } from './routine-search-menu';

export { menuMount };

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
    /** Undefined when the folder is cleared. */
    onChange(projectId: string | undefined): void;
  }>;
};

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/**
 * One setting of an open step: its name in a fixed column, its control
 * beside it. A narrow step stacks them.
 */
export function PropRow(props: {
  label: string;
  /** Top-align the name with a tall control, like a message. */
  tall?: boolean;
  children: JSX.Element;
}) {
  return (
    <div
      class={cn(
        'grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2.5 gap-y-1 @max-[30rem]/step:grid-cols-1',
        props.tall ? 'items-start' : 'items-center'
      )}
    >
      <span
        class={cn(
          'min-w-0 truncate text-[13px] text-ink-muted',
          props.tall && 'pt-1.5'
        )}
      >
        {props.label}
      </span>
      <div class="flex min-w-0 flex-wrap items-center gap-1.5">
        {props.children}
      </div>
    </div>
  );
}

/** A muted line under a step's settings. */
export function StepNote(props: { children: JSX.Element }) {
  return <p class="text-xs text-ink-muted">{props.children}</p>;
}

/** A token that picks one of a few fixed options. */
export function OptionMenu(props: {
  label: string;
  value: unknown;
  options: readonly { id: string; label: string }[];
  onChange(id: string): void;
}) {
  let trigger: HTMLButtonElement | undefined;
  const selected = () =>
    props.options.find((option) => option.id === props.value);
  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger
        ref={trigger}
        variant={selected() ? 'secondary' : 'outline'}
        aria-label={props.label}
        class="max-w-full gap-1.5"
      >
        <span class="truncate">{selected()?.label ?? 'Choose…'}</span>
        <CaretDownIcon class="size-3 shrink-0 text-ink-muted" />
      </Dropdown.Trigger>
      <Dropdown.Content
        portalScope="local"
        mount={menuMount(trigger)}
        class="min-w-48"
      >
        <Dropdown.Group>
          <For each={props.options}>
            {(option) => (
              <Dropdown.Item onSelect={() => props.onChange(option.id)}>
                <span class="flex-1">{option.label}</span>
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

/** A few fixed values side by side, like Low · Medium · High · Urgent. */
function ValueTabs(props: {
  label: string;
  value: unknown;
  options: readonly { id: string; label: string }[];
  wrap?: boolean;
  onChange(id: string): void;
}) {
  return (
    <Tabs
      aria-label={props.label}
      size="sm"
      wrap={props.wrap}
      options={props.options.map((option) => ({
        value: option.id,
        label: option.label,
      }))}
      value={typeof props.value === 'string' ? props.value : undefined}
      onChange={props.onChange}
    />
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
      <PropRow label="On">
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
      </PropRow>
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
  const description = () =>
    stepActions.find((action) => action.key === key())?.description;
  const created = () => (key() === 'create_task' ? 'task' : 'document');
  return (
    <div class="grid min-w-0 gap-3">
      <TargetRow
        step={props.step}
        scope={props.scope}
        onChange={props.onChange}
      />
      <Switch>
        <Match when={key() === 'add_label' || key() === 'remove_label'}>
          <PropRow label="Label">
            <ActionValue
              step={props.step}
              slots={props.slots}
              onChange={(patch) => set(patch)}
            />
          </PropRow>
          <StepNote>
            Matched by name in each email’s own inbox, so it works across
            inboxes.
          </StepNote>
        </Match>
        <Match when={key() === 'add_tag'}>
          <PropRow label="Tag">
            <ActionValue
              step={props.step}
              slots={props.slots}
              onChange={(patch) => set(patch)}
            />
          </PropRow>
        </Match>
        <Match when={key() === 'assign'}>
          <PropRow label="To">
            <ActionValue
              step={props.step}
              slots={props.slots}
              onChange={(patch) => set(patch)}
            />
          </PropRow>
        </Match>
        <Match when={key() === 'set_status'}>
          <PropRow label="Status">
            <ValueTabs
              label="Status"
              wrap
              value={args().option_id}
              options={statusOptions}
              onChange={(option_id) => set({ option_id })}
            />
          </PropRow>
        </Match>
        <Match when={key() === 'set_priority'}>
          <PropRow label="Priority">
            <ValueTabs
              label="Priority"
              value={args().option_id}
              options={priorityOptions}
              onChange={(option_id) => set({ option_id })}
            />
          </PropRow>
        </Match>
        <Match when={key() === 'sender_policy'}>
          <PropRow label="Treat as">
            <ValueTabs
              label="Sender policy"
              value={args().policy}
              options={senderPolicies}
              onChange={(policy) => set({ policy })}
            />
          </PropRow>
          <StepNote>Applies to future mail from this sender.</StepNote>
        </Match>
        <Match when={key() === 'move'}>
          <PropRow label="Folder">
            <props.slots.FolderPicker
              value={text(args().projectId) || undefined}
              // Moving needs a folder; clearing leaves the one chosen.
              onChange={(projectId) => projectId && set({ projectId })}
            />
          </PropRow>
        </Match>
        <Match when={key() === 'create_task' || key() === 'create_document'}>
          <PropRow label="Title">
            <FieldText
              label="Title"
              value={text(args().documentName)}
              placeholder={
                key() === 'create_task' ? 'Follow up' : 'Daily brief'
              }
              scope={props.scope}
              onChange={(documentName) => set({ documentName })}
            />
          </PropRow>
          <PropRow label={key() === 'create_task' ? 'Details' : 'Content'} tall>
            <FieldText
              label={key() === 'create_task' ? 'Details' : 'Content'}
              value={text(args().fileContent)}
              placeholder="Optional"
              multiline
              scope={props.scope}
              onChange={(fileContent) => set({ fileContent })}
            />
          </PropRow>
          <PropRow label="Folder">
            <props.slots.FolderPicker
              value={text(args().projectId) || undefined}
              onChange={(projectId) => {
                // Back to None: the new item goes nowhere in particular.
                const { projectId: _cleared, ...rest } = props.step.arguments;
                props.onChange({
                  ...props.step,
                  arguments: projectId ? { ...rest, projectId } : rest,
                });
              }}
            />
          </PropRow>
          <Show when={props.step.output}>
            <StepNote>Later steps can act on this {created()}.</StepNote>
          </Show>
        </Match>
        <Match when={key() === 'send_message'}>
          <PropRow label="Channel">
            <props.slots.ChannelPicker
              value={text(args().channel_id)}
              onChange={(channel_id) => set({ channel_id })}
            />
          </PropRow>
          <PropRow label="Message" tall>
            <FieldText
              label="Message"
              value={text(args().content)}
              placeholder="Write the message"
              multiline
              scope={props.scope}
              onChange={(content) => set({ content })}
            />
          </PropRow>
        </Match>
        <Match when={key() === 'comment' || key() === 'reply_in_thread'}>
          <PropRow label={key() === 'comment' ? 'Comment' : 'Reply'} tall>
            <FieldText
              label={key() === 'comment' ? 'Comment' : 'Reply'}
              value={text(args().content)}
              placeholder={
                key() === 'comment' ? 'Write the comment' : 'Write the reply'
              }
              multiline
              scope={props.scope}
              onChange={(content) => set({ content })}
            />
          </PropRow>
        </Match>
        <Match when={key() === 'other'}>
          <ArgumentsEditor step={props.step} onChange={props.onChange} />
        </Match>
        <Match when={description()}>
          {(note) => <StepNote>{note()}</StepNote>}
        </Match>
      </Switch>
    </div>
  );
}
