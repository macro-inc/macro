import ListChecks from '@phosphor-icons/core/regular/list-checks.svg';
import { invalidateAuthoredForm } from '@queries/storage/form-tool-review';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import { BaseTool } from './BaseTool';
import type { FormToolHandlerMap } from './FormsHandlers';
import { FormAccessChatCompose } from './forms/ChatCompose';
import { MutationDetails, SavedFormDetails } from './forms/ResultDetails';
import type { FormMutation } from './forms/types';
import { Tool } from './Tool';
import { createToolRenderer, type RenderContext } from './ToolRenderer';

function Card(props: {
  label: string;
  status?: string;
  renderContext: RenderContext['renderContext'];
  children?: JSX.Element;
}) {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <BaseTool
      icon={ListChecks}
      type="call"
      renderContext={props.renderContext}
      response={expanded() ? props.children : undefined}
    >
      <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
        <span class="truncate">{props.label}</span>
        <Tool.ResultToggle
          expanded={expanded()}
          onToggle={() => setExpanded((value) => !value)}
          showToggle={props.children !== undefined}
          status={props.status}
        />
      </div>
    </BaseTool>
  );
}
function mutationStatus(result: FormMutation | undefined) {
  if (!result) return undefined;
  return result.state === 'completed'
    ? 'Saved'
    : result.state === 'savedPendingProjection'
      ? 'Draft saved'
      : result.state === 'pending'
        ? 'Pending'
        : 'Partially saved';
}
function mutationHandler<Name extends 'CreateForm' | 'EditForm'>(
  name: Name,
  label: string
) {
  return createToolRenderer({
    name,
    handleResponse: (ctx) => {
      const saved = ctx.tool.data.saved;
      if (saved)
        void invalidateAuthoredForm(saved.form.id, saved.form.databaseId);
    },
    render: (ctx) => (
      <Card
        label={label}
        status={mutationStatus(ctx.response?.data)}
        renderContext={ctx.renderContext}
      >
        <Show when={ctx.response?.data}>
          {(result) => <MutationDetails result={result()} />}
        </Show>
      </Card>
    ),
  });
}
const createForm = mutationHandler('CreateForm', 'Create form');
const editForm = mutationHandler('EditForm', 'Edit form');
type ReadResponse = NamedTool<'ReadForm', 'response'>['data'];
function authoringRead(result?: ReadResponse) {
  return result?.view === 'authoring' ? result : undefined;
}
function respondentRead(result?: ReadResponse) {
  return result?.view === 'respondent' ? result : undefined;
}
function operationRead(result?: ReadResponse) {
  return result?.view === 'operation' ? result.operation : undefined;
}
const readForm = createToolRenderer({
  name: 'ReadForm',
  render: (ctx) => (
    <Card
      label="Read form"
      status={ctx.response ? 'Loaded' : undefined}
      renderContext={ctx.renderContext}
    >
      <Switch>
        <Match when={authoringRead(ctx.response?.data)}>
          {(read) => (
            <div class="space-y-3">
              <SavedFormDetails saved={read().saved} />
              <Show when={read().summary}>
                {(summary) => (
                  <p class="text-sm text-ink-muted">
                    {summary().submitted} submitted responses ·{' '}
                    {summary().stopped} signed-in respondents stopped ·{' '}
                    {summary().rows} rows in the table (including other sources)
                  </p>
                )}
              </Show>
              <Show when={read().operation}>
                {(operation) => (
                  <div class="text-sm">
                    <p>Operation: {mutationStatus(operation())}</p>
                    <For each={operation().diagnostics}>
                      {(diagnostic) => (
                        <p class="text-ink-muted">{diagnostic.message}</p>
                      )}
                    </For>
                  </div>
                )}
              </Show>
            </div>
          )}
        </Match>
        <Match when={respondentRead(ctx.response?.data)}>
          {(read) => (
            <div class="space-y-2 text-sm">
              <p>{read().detail.form.name}</p>
              <p>
                {read().acceptingResponses
                  ? 'Accepting responses'
                  : 'Not accepting responses'}
              </p>
              <a
                href={read().respondentUrl}
                class="text-accent hover:underline"
              >
                Open respondent page
              </a>
              <For each={read().detail.sections}>
                {(section) => (
                  <p>
                    {section.title ||
                      (section.kind === 'gate'
                        ? 'Screener'
                        : section.kind === 'booking'
                          ? 'Booking'
                          : 'Questions')}
                  </p>
                )}
              </For>
            </div>
          )}
        </Match>
        <Match when={operationRead(ctx.response?.data)}>
          {(operation) => <MutationDetails result={operation()} />}
        </Match>
      </Switch>
    </Card>
  ),
});
const listForms = createToolRenderer({
  name: 'ListForms',
  render: (ctx) => (
    <Card
      label="Find forms"
      status={ctx.response ? `${ctx.response.data.total} found` : undefined}
      renderContext={ctx.renderContext}
    >
      <Show when={ctx.response?.data}>
        {(result) => (
          <div class="space-y-2 text-sm">
            <For each={result().forms} fallback={<p>No matching forms.</p>}>
              {(item) => (
                <div>
                  <a class="text-accent hover:underline" href={item.editorUrl}>
                    {item.form.name}
                  </a>
                  <span class="ml-2 text-ink-muted">
                    {item.form.status} · {item.access}
                  </span>
                </div>
              )}
            </For>
            <Show when={result().truncated}>
              <p class="text-ink-muted">
                Showing the first 50. Narrow the search to see more.
              </p>
            </Show>
          </div>
        )}
      </Show>
    </Card>
  ),
});
type AccessResult = NamedTool<'SetFormAccess', 'response'>['data'];
function accessResult(response?: AccessResult): FormMutation | undefined {
  return typeof response === 'object' &&
    response !== null &&
    'UserAction' in response
    ? response.UserAction
    : undefined;
}
const setFormAccess = createToolRenderer({
  name: 'SetFormAccess',
  handleResponse: (ctx) => {
    const saved = accessResult(ctx.tool.data)?.saved;
    if (saved)
      void invalidateAuthoredForm(saved.form.id, saved.form.databaseId);
  },
  render: (ctx) => (
    <Switch
      fallback={<Card label="Share form" renderContext={ctx.renderContext} />}
    >
      <Match when={ctx.response?.data === 'PendingUserExecution'}>
        <FormAccessChatCompose
          chatId={ctx.chat_id}
          messageId={ctx.message_id}
          toolCallId={ctx.tool.id}
          name="SetFormAccess"
          initialData={ctx.tool.data}
          streamLocked={ctx.renderContext.isStreaming}
        />
      </Match>
      <Match when={ctx.response?.data === 'Rejected'}>
        <Card
          label="Share form"
          status="Canceled"
          renderContext={ctx.renderContext}
        />
      </Match>
      <Match when={accessResult(ctx.response?.data)}>
        {(result) => (
          <Card
            label="Share form"
            status={mutationStatus(result())}
            renderContext={ctx.renderContext}
          >
            <MutationDetails result={result()} />
          </Card>
        )}
      </Match>
    </Switch>
  ),
});
export const formsToolHandlers: FormToolHandlerMap = {
  CreateForm: createForm,
  ReadForm: readForm,
  EditForm: editForm,
  ListForms: listForms,
  SetFormAccess: setFormAccess,
};
