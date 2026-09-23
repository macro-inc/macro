import AgentIcon from '@phosphor/sparkle.svg';
import XIcon from '@phosphor/x.svg';
import { Avatar, Button, Dialog, Panel } from '@ui';
import { type Accessor, createMemo, For, type JSX, Show } from 'solid-js';
import { AgentModelPicker } from '../components/model-picker';
import { OptionSwitch } from '../components/option-switch';
import { RuntimePicker } from '../components/runtime-picker';
import type { AgentEditorSource } from '../context/editor-source';
import type { AgentApp, AgentDraft } from '../core/types';
import { AgentInstructionsEditor } from '../instructions-editor';
import { createAgentDraft } from '../primitives/create-agent-draft';

const INSTRUCTION_EXAMPLES = [
  {
    name: 'Research assistant',
    instructions:
      'Help me research questions using the documents, messages, and apps I can access. Compare sources, link to supporting evidence, and distinguish facts from assumptions. Ask for clarification when the scope is unclear.',
  },
  {
    name: 'Writing partner',
    instructions:
      'Help me turn rough ideas into clear, useful writing. Match the tone of the audience, preserve my meaning, and prefer concise language. When editing, explain the most important changes.',
  },
  {
    name: 'Code reviewer',
    instructions:
      'Review code for correctness, maintainability, and missing test coverage. Prioritize concrete problems, explain their impact, and suggest focused fixes. Cite the relevant files and lines.',
  },
];

export function AgentEditorView(props: {
  initial: AgentDraft;
  editing: boolean;
  source: AgentEditorSource;
  appsEnabled: boolean;
  onClose: () => void;
  returnFocus?: () => HTMLElement | undefined;
  renderApps: (
    servers: Accessor<AgentApp[]>,
    onChange: (servers: AgentApp[]) => void,
    container: () => HTMLElement | undefined
  ) => JSX.Element;
  renderChannels: (
    ids: Accessor<string[]>,
    onChange: (ids: string[]) => void
  ) => JSX.Element;
}) {
  const editor = createAgentDraft(props.initial, props.source, props.editing);
  let avatarInput: HTMLInputElement | undefined;
  let dialogContent: HTMLDivElement | undefined;
  const close = () => {
    if (editor.busy()) return;
    if (editor.dirty()) editor.setDiscarding(true);
    else props.onClose();
  };
  const submit = async () => {
    if (await editor.save()) props.onClose();
  };
  const selectedApps = createMemo(() => {
    const apps = editor.draft().apps;
    return apps.scope === 'selected' ? apps.servers : [];
  });
  const selectedChannelIds = createMemo(() => editor.draft().channelIds);
  const runtimeOptions = createMemo(() => props.source.runtimes());
  const canBypassPermissions = createMemo(
    () => editor.runtime()?.allowPermissionBypass === true
  );
  const permissionOptions = createMemo(() =>
    canBypassPermissions()
      ? [
          { value: 'prompt', label: 'Always prompt' },
          { value: 'bypass', label: 'Always bypass' },
        ]
      : [{ value: 'prompt', label: 'Always prompt' }]
  );
  const runtimes = () =>
    runtimeOptions().filter(
      (runtime) =>
        runtime.id !== 'claude-cloud' ||
        props.source.catalog(runtime.id).state === 'available' ||
        runtime.id === editor.draft().runtimeId
    );
  const uploadAvatar = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string')
        editor.update('avatarUrl', reader.result);
    });
    reader.readAsDataURL(file);
  };

  return (
    <Dialog
      open
      position="center"
      visibleScrim
      class="w-[min(1080px,calc(100vw-24px))]"
      contentRef={(element) => {
        dialogContent = element;
      }}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      onCloseAutoFocus={(event) => {
        const trigger = props.returnFocus?.();
        if (!trigger?.isConnected) return;
        event.preventDefault();
        trigger.focus({ preventScroll: true });
      }}
    >
      <Panel
        depth={2}
        class="relative flex h-[min(800px,90dvh)] flex-col overflow-hidden rounded-xl border border-edge text-ink shadow-xl"
      >
        <Panel.Header class="shrink-0 gap-2 bg-panel px-6 py-4 pr-12">
          <AgentIcon class="size-4 text-accent" />
          <Dialog.Title class="text-base font-semibold">
            {props.editing ? 'Edit agent' : 'Create agent'}
          </Dialog.Title>
        </Panel.Header>
        <Dialog.Description class="sr-only">
          Give your agent a role and instructions, then choose where it runs and
          what it can use.
        </Dialog.Description>
        <form
          id="agent-form"
          class="grid min-h-0 flex-1 gap-6 overflow-y-auto bg-ink/[0.025] p-6 md:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)] md:grid-rows-[auto_minmax(0,1fr)] md:overflow-hidden"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset
            disabled={editor.busy()}
            class="min-w-0 md:col-start-1 md:row-start-1 md:pr-3"
          >
            <legend class="sr-only">Agent identity</legend>
            <div>
              <div class="flex items-start gap-3">
                <div class="min-w-0 flex-1">
                  <label class="block">
                    <span class="sr-only">Name</span>
                    <input
                      class="settings-input w-full text-base font-medium"
                      placeholder="Agent name"
                      value={editor.draft().name}
                      onInput={(event) =>
                        editor.setName(event.currentTarget.value)
                      }
                    />
                  </label>
                  <label class="mt-2 flex items-center gap-2 rounded-md border border-edge-muted bg-input px-3 focus-within:ring-2 focus-within:ring-accent/20">
                    <span class="text-sm text-ink-muted" aria-hidden="true">
                      @
                    </span>
                    <span class="sr-only">@tag</span>
                    <input
                      class="h-8 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none"
                      placeholder="handle"
                      value={editor.draft().handle}
                      onInput={(event) =>
                        editor.setHandle(event.currentTarget.value)
                      }
                    />
                  </label>
                </div>
                <button
                  type="button"
                  aria-label="Upload avatar"
                  title="Upload avatar"
                  class="order-first rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  onClick={() => avatarInput?.click()}
                >
                  <Avatar
                    size="lg"
                    class="bg-accent/5 text-accent ring ring-edge-muted"
                  >
                    <Show
                      when={editor.draft().avatarUrl}
                      fallback={
                        <Avatar.Fallback>
                          <AgentIcon class="size-5" />
                        </Avatar.Fallback>
                      }
                    >
                      {(url) => <Avatar.Image src={url()} alt="Agent avatar" />}
                    </Show>
                  </Avatar>
                </button>
                <input
                  ref={avatarInput}
                  type="file"
                  accept="image/*"
                  class="hidden"
                  onChange={(event) =>
                    uploadAvatar(event.currentTarget.files?.[0])
                  }
                />
              </div>
              <p class="mt-2 text-xs text-ink-muted">
                Give it a name. Use its @handle to mention it in a channel.
              </p>
            </div>
          </fieldset>
          <div class="flex min-w-0 flex-col self-start rounded-lg border border-edge bg-input shadow-sm md:col-start-2 md:row-span-2 md:row-start-1 md:min-h-0 md:self-stretch">
            <div class="shrink-0 border-b border-edge-muted px-4 py-3">
              <h2 class="text-sm font-semibold text-ink">Instructions</h2>
              <p class="mt-1 text-xs leading-5 text-ink-muted">
                What should this agent do? Describe its role, how it should
                work, and what a good result looks like.
              </p>
            </div>
            <AgentInstructionsEditor
              markdown={editor.draft().instructions}
              onChange={(markdown) => editor.update('instructions', markdown)}
              disabled={editor.busy()}
              class="h-64 flex-none overflow-y-auto px-4 py-4 md:h-auto md:min-h-0 md:flex-1"
              placeholder="Describe your agent’s role, how it should work, and what a good result looks like…"
            />
            <Show when={!props.editing && !editor.draft().instructions}>
              <div class="shrink-0 border-t border-edge-muted p-4">
                <p class="mb-2 text-xs text-ink-muted">
                  Need a starting point?
                </p>
                <div class="flex flex-wrap gap-1.5">
                  <For each={INSTRUCTION_EXAMPLES}>
                    {(example) => (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={editor.busy()}
                        onClick={() =>
                          editor.update('instructions', example.instructions)
                        }
                      >
                        {example.name}
                      </Button>
                    )}
                  </For>
                </div>
              </div>
            </Show>
            <p class="shrink-0 border-t border-edge-muted px-4 py-3 text-xs text-ink-muted">
              Used at the start of every new conversation with this agent.
            </p>
          </div>
          <fieldset
            disabled={editor.busy()}
            class="flex min-h-0 min-w-0 flex-col gap-6 md:col-start-1 md:row-start-2 md:overflow-y-auto md:pr-3"
          >
            <legend class="sr-only">Agent settings</legend>
            <EditorSection title="Who can manage it">
              <OptionSwitch
                label="Share"
                name="agent-share"
                value={editor.draft().share}
                options={[
                  {
                    value: 'Private',
                    label: 'Private',
                    disabled: !props.source.canMakePrivate(),
                  },
                  {
                    value: 'Team',
                    label: 'Team',
                    disabled: !props.source.canShareWithTeam(),
                  },
                ]}
                onChange={(value) => editor.update('share', value)}
              />
              <p class="mt-2 text-xs text-ink-muted">
                {editor.draft().share === 'Team'
                  ? 'Everyone on your team can use and edit this agent.'
                  : 'Managed by you. You can also make it available in selected channels.'}
              </p>
              <Show when={!props.source.canShareWithTeam()}>
                <p class="mt-2 text-xs text-ink-muted">
                  Create or join a team in Team settings to share agents.
                </p>
              </Show>
              <Show when={!props.source.canMakePrivate()}>
                <p class="mt-2 text-xs text-ink-muted">
                  Only the agent creator can make it private.
                </p>
              </Show>
            </EditorSection>

            <EditorSection
              title="Runtime"
              description="Where your agent runs. Macro is ready to use."
            >
              <RuntimePicker
                runtimes={runtimes()}
                selected={editor.draft().runtimeId}
                team={editor.draft().share === 'Team'}
                teamId={props.source.teamId()}
                onChange={editor.setRuntime}
              />
              <Show when={!editor.runtime()}>
                <p class="mt-2 text-xs text-negative">
                  This agent's runtime is no longer available. Choose another
                  runtime or reconnect it in Runtimes.
                </p>
              </Show>
              <Show when={editor.teamRuntimeMismatch()}>
                <p role="alert" class="mt-2 text-xs text-negative">
                  This computer is private. Choose a team runtime or keep the
                  agent private.
                </p>
              </Show>
              <Show when={editor.runtime()?.connected === false}>
                <p class="mt-2 text-xs text-ink-muted">
                  This computer is offline. It needs to reconnect before the
                  agent can run.
                </p>
              </Show>
              <p class="mt-2 text-xs text-ink-muted">
                Connect accounts and pair computers in the Runtimes section
                below your agents.
              </p>
              <div class="mt-4">
                <AgentModelPicker
                  catalog={editor.catalog()}
                  models={editor.modelOptions()}
                  value={editor.modelId()}
                  runtimeName={editor.runtime()?.name ?? 'this runtime'}
                  onChange={(id) => editor.update('modelId', id)}
                  onRetry={() => {
                    void props.source.retryModels(editor.draft().runtimeId);
                  }}
                />
              </div>
              <Show when={editor.runtime()?.kind === 'macrod'}>
                <div class="mt-4 border-t border-edge-muted pt-4">
                  <h3 class="mb-2 text-xs font-medium">Permission requests</h3>
                  <OptionSwitch
                    label="Permission requests"
                    name="agent-permission-policy"
                    value={editor.autoAcceptPermissions() ? 'bypass' : 'prompt'}
                    options={permissionOptions()}
                    onChange={(value) =>
                      editor.update('autoAcceptPermissions', value === 'bypass')
                    }
                  />
                  <p class="mt-2 text-xs text-ink-muted">
                    {editor.autoAcceptPermissions()
                      ? 'Approve tool calls without asking.'
                      : 'Session editors approve or reject each permission request.'}
                  </p>
                  <Show when={!canBypassPermissions()}>
                    <p class="mt-2 text-xs text-ink-muted">
                      This runtime requires permission prompts.
                    </p>
                  </Show>
                </div>
              </Show>
            </EditorSection>

            <Show when={props.appsEnabled}>
              <EditorSection
                title="Connected apps"
                description="Tools and context the agent can use."
              >
                <OptionSwitch
                  label="Connections"
                  name="agent-apps"
                  value={editor.draft().apps.scope}
                  options={[
                    { value: 'owner_connections', label: 'All connected apps' },
                    { value: 'selected', label: 'Choose apps' },
                  ]}
                  onChange={editor.setAppScope}
                />
                <p class="mt-2 text-xs text-ink-muted">
                  Each person uses their own accounts when running this agent.
                </p>
                <Show when={editor.draft().apps.scope === 'selected'}>
                  <div class="mt-3">
                    {props.renderApps(
                      selectedApps,
                      (servers) =>
                        editor.setApps({ scope: 'selected', servers }),
                      () => dialogContent
                    )}
                  </div>
                  <Show when={selectedApps().length === 0}>
                    <p class="mt-2 text-xs text-ink-muted">
                      No apps selected. This agent will run without connected
                      apps.
                    </p>
                  </Show>
                </Show>
              </EditorSection>
            </Show>

            <EditorSection
              title="Channels"
              description="Where people can mention this agent."
            >
              <OptionSwitch
                label="Channels"
                name="agent-channels"
                value={editor.draft().channelScope}
                options={[
                  { value: 'all', label: 'All channels' },
                  { value: 'selected', label: 'Specific channels' },
                ]}
                onChange={(value) => editor.update('channelScope', value)}
              />
              <Show
                when={editor.draft().channelScope === 'selected'}
                fallback={
                  <p class="mt-2 text-xs text-ink-muted">
                    {editor.draft().share === 'Private'
                      ? 'You can mention this agent in any channel.'
                      : 'Your team can mention this agent in any channel.'}
                  </p>
                }
              >
                <div class="mt-3">
                  {props.renderChannels(selectedChannelIds, (ids) =>
                    editor.update('channelIds', ids)
                  )}
                </div>
                <p class="mt-2 text-xs text-ink-muted">
                  People in the selected channels can mention this agent,
                  including when it is private.
                </p>
              </Show>
            </EditorSection>
          </fieldset>
        </form>
        <Panel.Footer class="shrink-0 flex-wrap justify-end gap-2 border-t border-edge-muted bg-panel px-6 py-4">
          <Show
            when={editor.discarding()}
            fallback={
              <>
                <div class="mr-auto min-w-0 flex-1 basis-48">
                  <Show
                    when={editor.error()}
                    fallback={
                      <p class="text-xs text-ink-muted">
                        {editor.validation() ||
                          (props.editing
                            ? 'Changes apply to new conversations.'
                            : 'You can change these settings later.')}
                      </p>
                    }
                  >
                    <p role="alert" class="text-xs text-negative">
                      {editor.error()}
                    </p>
                  </Show>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={editor.busy()}
                  onClick={close}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  form="agent-form"
                  variant="cta"
                  size="sm"
                  disabled={editor.busy() || !!editor.validation()}
                >
                  {editor.busy()
                    ? 'Saving…'
                    : props.editing
                      ? 'Save changes'
                      : 'Create agent'}
                </Button>
              </>
            }
          >
            <p role="alert" class="mr-auto text-sm text-ink">
              Discard your unsaved changes?
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => editor.setDiscarding(false)}
            >
              Keep editing
            </Button>
            <Button size="sm" variant="danger" onClick={props.onClose}>
              Discard changes
            </Button>
          </Show>
        </Panel.Footer>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          class="absolute top-2 right-3"
          aria-label="Close agent editor"
          disabled={editor.busy()}
          onClick={close}
        >
          <XIcon />
        </Button>
      </Panel>
    </Dialog>
  );
}

function EditorSection(props: {
  title: string;
  description?: string;
  children: JSX.Element;
}) {
  return (
    <section>
      <h3 class="mb-2 text-xs font-semibold text-ink">{props.title}</h3>
      <Show when={props.description}>
        <p class="mb-3 text-xs text-ink-muted">{props.description}</p>
      </Show>
      {props.children}
    </section>
  );
}
