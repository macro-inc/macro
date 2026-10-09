import { Button } from '@ui';
import { createUniqueId, For, type JSX, Show, Suspense } from 'solid-js';
import { FieldGrid, FieldInput, FieldSelect } from '../components/fields';
import type { InputDisplay } from '../context/capabilities';
import '../universal-input.css';
import {
  actionLabels,
  type Field,
  intentLabels,
  intentSchema,
  intents,
  rankIntents,
} from '../core/input';
import type { UniversalInputController } from '../primitives/universal-input';

function ComposerFooter(props: {
  state: UniversalInputController;
  statusId: string;
}) {
  const s = props.state;
  const action = () => {
    if (s.sending()) return 'Working…';
    const intent = s.draft().intent;
    return intent ? actionLabels[intent] : 'Continue';
  };
  return (
    <div class="flex flex-wrap items-center justify-between gap-3">
      <span id={props.statusId} class="text-xs text-ink-muted">
        {s.validation() ?? '⌘ / Ctrl + Enter'}
      </span>
      <Button
        variant="strong"
        disabled={s.sending() || s.pending() || !!s.validation()}
        onClick={() => void s.submit()}
      >
        {action()}
      </Button>
    </div>
  );
}

export function UniversalComposer(props: {
  state: UniversalInputController;
  actions: InputDisplay;
  taskFields: JSX.Element;
  registerEditor?: (editor: HTMLTextAreaElement) => void;
}) {
  const s = props.state;
  const a = props.actions;
  const type = () => s.draft().intent;
  const listId = createUniqueId();
  const field = (
    key: Field,
    label: string,
    options?: { multiline?: boolean; type?: string; list?: string }
  ) => (
    <FieldInput
      label={label}
      value={s.fields()[key]}
      disabled={s.sending()}
      onChange={(value) => s.edit(key, value)}
      {...options}
    />
  );
  const summary = () => {
    const f = s.fields();
    if (type() !== 'calendar' || !f.start || !f.end) return '';
    const start = new Date(f.start);
    const end = new Date(f.end);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()))
      return '';
    return `${start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}, ${start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}–${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
  };
  const recipientSummary = () =>
    a
      .recipients(s.fields(), type() === 'message')
      .recipients.map((p) =>
        p.email ? `${p.label} <${p.email}>` : `#${p.label}`
      )
      .join(', ');
  return (
    <section class="min-w-0" aria-label="Create or find something">
      <div class="rounded-xl border border-edge-muted bg-panel shadow-sm transition-[border-color] focus-within:border-edge">
        <textarea
          ref={props.registerEditor}
          aria-label="Your input"
          aria-describedby={`${listId}-status`}
          data-universal-input=""
          class="block min-h-24 max-h-96 w-full resize-y rounded-t-xl bg-transparent px-5 py-4 text-base leading-relaxed text-ink outline-none"
          value={s.draft().text}
          disabled={s.sending()}
          maxLength={16000}
          onInput={(e) => s.setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              (e.metaKey || e.ctrlKey) &&
              !e.isComposing
            ) {
              e.preventDefault();
              void s.submit();
            }
          }}
        />
        <Show when={s.draft().text.trim() || a.attachmentCount()}>
          <fieldset
            disabled={s.sending()}
            class="universal-input-fields min-w-0 space-y-4 border-t border-edge-muted px-5 py-4"
          >
            <div class="flex flex-wrap items-center gap-2">
              <select
                aria-label="Content type"
                class="rounded-md border border-edge-muted bg-input px-2 py-1 text-xs text-ink"
                disabled={s.sending()}
                value={s.draft().locked ? (type() ?? '') : ''}
                onChange={(e) => {
                  const selected = intentSchema.safeParse(
                    e.currentTarget.value
                  );
                  s.choose(selected.success ? selected.data : undefined);
                }}
              >
                <option value="">
                  Auto{type() ? ` · ${intentLabels[type()!]}` : ''}
                </option>
                <For each={intents}>
                  {(intent) => (
                    <option value={intent}>{intentLabels[intent]}</option>
                  )}
                </For>
              </select>
              <Show when={!type()}>
                <For each={rankIntents(s.scores()).slice(0, 2)}>
                  {(candidate) => (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => s.choose(candidate.intent)}
                    >
                      {intentLabels[candidate.intent]}
                    </Button>
                  )}
                </For>
              </Show>
              <Show when={s.pending()}>
                <span role="status" class="text-xs text-ink-muted">
                  {type() ? 'Updating fields…' : 'Finding the shape…'}
                </span>
              </Show>
            </div>
            <Show when={a.attachmentCount()}>
              <div class="flex items-center gap-2 text-xs text-ink-muted">
                <span>{a.attachmentCount()} attached item(s) · AI context</span>
                <Button size="sm" variant="ghost" onClick={a.clearAttachments}>
                  Remove
                </Button>
              </div>
            </Show>
            <Show when={type() === 'ai'}>
              <FieldGrid>
                <Show when={a.agentsEnabled()}>
                  <FieldSelect
                    label="Agent"
                    value={s.fields().botId || 'macro'}
                    options={a.roster().map((agent) => ({
                      id: agent.id,
                      label: agent.name,
                      disabled: !!agent.unavailableReason,
                    }))}
                    onChange={(v) => {
                      s.edit('botId', v);
                      s.edit('model', '');
                    }}
                  />
                </Show>
                <FieldSelect
                  label="Model"
                  value={s.fields().model || a.model()}
                  options={a.models()}
                  onChange={(v) => s.edit('model', v)}
                />
              </FieldGrid>
            </Show>
            <Show when={type() === 'search'}>
              {field('query', 'Search for')}
            </Show>
            <Show
              when={
                type() === 'note' || type() === 'task' || type() === 'calendar'
              }
            >
              {field('title', 'Title')}
            </Show>
            <Show when={type() === 'task'}>
              {field('body', 'Description', { multiline: true })}
              {field('due_date', 'Due date', { type: 'date' })}
              <Suspense
                fallback={
                  <span class="text-xs text-ink-muted">
                    Loading task properties…
                  </span>
                }
              >
                {props.taskFields}
              </Suspense>
            </Show>
            <Show when={type() === 'email'}>
              <FieldSelect
                label="From"
                value={a.selectedInbox(s.fields())?.id ?? ''}
                options={a.inboxes().map((inbox) => ({
                  id: inbox.id,
                  label: inbox.email_address,
                }))}
                onChange={(v) => s.edit('inboxId', v)}
              />
            </Show>
            <Show when={type() === 'email' || type() === 'message'}>
              {field(
                'recipients',
                type() === 'message' ? 'To person or channel' : 'To',
                { list: listId }
              )}
              <p class="text-xs text-ink-muted" aria-live="polite">
                {recipientSummary()}
              </p>
            </Show>
            <Show when={type() === 'email'}>{field('subject', 'Subject')}</Show>
            <Show when={type() === 'email' || type() === 'message'}>
              {field('body', 'Outgoing message', { multiline: true })}
            </Show>
            <Show when={type() === 'calendar'}>
              <FieldGrid>
                {field('start', 'Starts', { type: 'datetime-local' })}
                {field('end', 'Ends', { type: 'datetime-local' })}
              </FieldGrid>
              <p class="text-sm text-ink" aria-live="polite">
                {summary()}
              </p>
              <FieldSelect
                label="Calendar"
                value={a.selectedCalendar(s.fields())?.id ?? ''}
                options={a.calendars().map((c) => ({
                  id: c.id,
                  label: `${c.name} · ${c.emailAddress}`,
                }))}
                onChange={(v) => s.edit('calendarId', v)}
              />
              <FieldGrid>
                {field('guests', 'Invite guests (optional)', { list: listId })}
                {field('location', 'Location (optional)')}
              </FieldGrid>
            </Show>
            <datalist id={listId}>
              <For each={type() === 'message' ? a.destinations() : a.people()}>
                {(person) => (
                  <option value={person.email ?? person.id}>
                    {person.kind === 'channel' ? '#' : ''}
                    {person.label}
                  </option>
                )}
              </For>
            </datalist>
            <ComposerFooter state={s} statusId={`${listId}-status`} />
            <Show when={s.error()}>
              <p role="alert" class="text-sm text-failure">
                {s.error()}
              </p>
            </Show>
          </fieldset>
        </Show>
      </div>
      <Show when={s.result()}>
        {(result) => (
          <div
            role="status"
            class="mt-3 flex items-center gap-3 text-sm text-ink-muted"
          >
            {result().message}
            <Show when={result().open}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => result().open?.()}
              >
                Open
              </Button>
            </Show>
          </div>
        )}
      </Show>
    </section>
  );
}
