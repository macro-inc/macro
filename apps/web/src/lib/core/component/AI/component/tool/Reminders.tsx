import { formatDateAndTime } from '@entity';
import BellSimple from '@phosphor-icons/core/regular/bell-simple.svg';
import Check from '@phosphor-icons/core/regular/check.svg';
import Trash from '@phosphor-icons/core/regular/trash.svg';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import type {
  ListReminders as ListRemindersTool,
  ReminderEntityType,
  UpdateReminder as UpdateReminderTool,
} from '@service-cognition/generated/tools/types';
import { createSignal, For, Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

type ToolReminder = NamedTool<
  'ListReminders',
  'response'
>['data']['reminders'][number];

const ENTITY_TYPE_LABELS: Record<ReminderEntityType, string> = {
  document: 'a document',
  ai_chat: 'a chat',
  project: 'a project',
  email: 'an email thread',
  channel: 'a channel',
  call: 'a call',
  calendar_event: 'a calendar event',
};

/** What the list call asked for, in the same voice as the notification tools. */
const formatReminderFilters = (filters: ListRemindersTool) => {
  if (filters.reminderIds?.length) {
    const count = filters.reminderIds.length;
    return `${count} reminder${count === 1 ? '' : 's'} by id`;
  }

  const parts = [filters.completed ? 'done' : 'not done'];
  if (filters.overdue != null) {
    parts.push(filters.overdue ? 'overdue' : 'upcoming');
  }

  let text = `filtered by ${parts.join(' and ')}`;
  if (filters.entityType) {
    text += ` for ${ENTITY_TYPE_LABELS[filters.entityType]}`;
  }
  return text;
};

/**
 * What an update actually changed, so the row is readable without expanding
 * the arguments. Reads off the request rather than the response because the
 * response is the merged reminder and no longer says which fields moved.
 */
const formatReminderUpdate = (update: UpdateReminderTool) => {
  const changes: string[] = [];
  if (update.completed === true) changes.push('mark done');
  if (update.completed === false) changes.push('reopen');
  if (update.remindAt)
    changes.push(`move to ${formatDateAndTime(update.remindAt)}`);
  if (update.description != null) changes.push('reword');
  return changes.length > 0 ? changes.join(', ') : 'update';
};

const ReminderList = (props: { reminders: ToolReminder[] }) => (
  <Tool.List>
    <div class="max-h-60 overflow-y-auto overscroll-contain">
      <For each={props.reminders}>
        {(reminder) => (
          <Tool.ListItem icon={<BellSimple class="size-4" />}>
            <div class="flex min-w-0 items-center justify-between gap-3">
              <span class="min-w-0 truncate text-ink">
                {reminder.description}
              </span>
              <span
                class="shrink-0 whitespace-nowrap text-xs"
                classList={{
                  'text-ink-extra-muted': !reminder.overdue,
                  'text-ink-muted': reminder.overdue,
                }}
              >
                {reminder.overdue ? 'Overdue · ' : ''}
                {formatDateAndTime(reminder.nextRunAt)}
              </span>
            </div>
          </Tool.ListItem>
        )}
      </For>
    </div>
  </Tool.List>
);

const listRemindersHandler = createToolRenderer({
  name: 'ListReminders',
  render: (ctx) => {
    const [isExpanded, setIsExpanded] = createSignal(false);
    const reminders = () => ctx.response?.data.reminders ?? [];
    const hasResults = () => reminders().length > 0;
    const statusText = () => {
      if (!ctx.response) return undefined;
      const count = reminders().length;
      if (count === 0) return 'No Results';
      return `${count} reminder${count === 1 ? '' : 's'}`;
    };

    return (
      <BaseTool
        align="start"
        icon={BellSimple}
        renderContext={ctx.renderContext}
        type="call"
        response={
          hasResults() && isExpanded() ? (
            <ReminderList reminders={reminders()} />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <div class="flex min-w-0 items-center justify-between gap-3 overflow-hidden">
            <span class="min-w-0 truncate">Read reminders</span>
            <Tool.ResultToggle
              expanded={isExpanded()}
              onToggle={() => setIsExpanded((expanded) => !expanded)}
              showToggle={hasResults()}
              status={statusText()}
            />
          </div>
          <div class="min-w-0 truncate text-xs text-ink-placeholder">
            {formatReminderFilters(ctx.tool.data)}
          </div>
        </div>
      </BaseTool>
    );
  },
});

const createReminderHandler = createToolRenderer({
  name: 'CreateReminder',
  render: (ctx) => (
    <BaseTool
      align="start"
      icon={BellSimple}
      renderContext={ctx.renderContext}
      type="call"
    >
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <div class="flex min-w-0 items-center gap-1.5 overflow-hidden">
          <span class="shrink-0">
            {ctx.response ? 'Created reminder' : 'Create reminder'}
          </span>
          <span class="min-w-0 truncate text-ink">
            {ctx.response?.data.description ?? ctx.tool.data.description}
          </span>
        </div>
        <div class="min-w-0 truncate text-xs text-ink-placeholder">
          {formatDateAndTime(
            ctx.response?.data.nextRunAt ?? ctx.tool.data.remindAt
          )}
          <Show when={ctx.tool.data.entityType}>
            {(entityType) => <> · about {ENTITY_TYPE_LABELS[entityType()]}</>}
          </Show>
        </div>
      </div>
    </BaseTool>
  ),
});

const updateReminderHandler = createToolRenderer({
  name: 'UpdateReminder',
  render: (ctx) => (
    <BaseTool
      align="start"
      icon={ctx.tool.data.completed === true ? Check : BellSimple}
      renderContext={ctx.renderContext}
      type="call"
    >
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <div class="flex min-w-0 items-center gap-1.5 overflow-hidden">
          <span class="shrink-0">
            {ctx.response ? 'Updated reminder' : 'Update reminder'}
          </span>
          <Show when={ctx.response?.data.description}>
            {(description) => (
              <span class="min-w-0 truncate text-ink">{description()}</span>
            )}
          </Show>
        </div>
        <div class="min-w-0 truncate text-xs text-ink-placeholder">
          {formatReminderUpdate(ctx.tool.data)}
          <Show when={ctx.response?.data.nextRunAt}>
            {(nextRunAt) => <> · fires {formatDateAndTime(nextRunAt())}</>}
          </Show>
        </div>
      </div>
    </BaseTool>
  ),
});

const deleteReminderHandler = createToolRenderer({
  name: 'DeleteReminder',
  render: (ctx) => (
    <BaseTool icon={Trash} renderContext={ctx.renderContext} type="call">
      {ctx.response ? 'Deleted reminder' : 'Delete reminder'}
    </BaseTool>
  ),
});

export {
  createReminderHandler,
  deleteReminderHandler,
  listRemindersHandler,
  updateReminderHandler,
};
