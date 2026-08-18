import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { For, Show } from 'solid-js';
import {
  HARNESS_OPTIONS,
  MODEL_OPTIONS,
  type PersonaFormErrors,
  type PersonaFormValues,
} from './personaForm';

/** The instructions editor.
 *
 * Deliberately no mentions and no emojis: the prompt is written verbatim into
 * the sandbox as markdown, and a mention node would serialize to a
 * `bot|<uuid>` the container has no way to resolve. Everything else follows
 * `createConfiguredChannelMarkdownEditor`. */
function createPromptEditor(onChange: (markdown: string) => void) {
  return buildConfig('markdown')
    .namespace('persona-system-prompt')
    .withActions({ ignoreActionIds: ['hr', 'table', 'latex'] })
    .withLinks({ floatingMenu: true, autoLinkMatchMode: 'common-tlds' })
    .withHistory({ timeGap: 400 })
    .withCode()
    .withFloatingFormatMenu()
    .onChange(onChange);
}

export function PersonaAgentFields(props: {
  value: PersonaFormValues;
  errors: PersonaFormErrors;
  /** Read once when the editor mounts, so the caller must not render this
   * until the persona it is editing has loaded. */
  initialSystemPrompt: string;
  onSystemPromptChange: (value: string) => void;
  onHarnessChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onRepoUrlChange: (value: string) => void;
}) {
  const promptEditor = createPromptEditor(props.onSystemPromptChange);

  return (
    <>
      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-medium">Instructions</span>
        <div class="min-h-40 rounded-md border border-edge-muted px-3 py-2.5 focus-within:border-accent">
          <MarkdownShell
            config={promptEditor}
            placeholder="Describe how this persona should behave, what it should prioritise, and anything it should never do."
            initialValue={props.initialSystemPrompt}
          />
        </div>
        <span class="text-xs text-ink-muted">
          Markdown. Prepended to every session this persona runs.
        </span>
      </div>

      <div class="mt-4 grid grid-cols-2 gap-3 mobile:grid-cols-1">
        <label class="flex flex-col gap-1.5">
          <span class="text-xs font-medium">Harness</span>
          <select
            class="settings-input w-full"
            value={props.value.harness}
            onChange={(event) =>
              props.onHarnessChange(event.currentTarget.value)
            }
          >
            <For each={HARNESS_OPTIONS}>
              {(option) => <option value={option.value}>{option.label}</option>}
            </For>
          </select>
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="text-xs font-medium">Model</span>
          <select
            class="settings-input w-full"
            value={props.value.model}
            onChange={(event) => props.onModelChange(event.currentTarget.value)}
          >
            <For each={MODEL_OPTIONS}>
              {(option) => <option value={option.value}>{option.label}</option>}
            </For>
          </select>
        </label>
      </div>

      <label class="mt-4 flex flex-col gap-1.5">
        <span class="text-xs font-medium">Repository</span>
        <input
          value={props.value.repoUrl}
          placeholder="https://github.com/macro-inc/macro"
          class="settings-input w-full"
          aria-invalid={!!props.errors.repoUrl}
          onInput={(event) => props.onRepoUrlChange(event.currentTarget.value)}
        />
        <Show
          when={props.errors.repoUrl}
          fallback={
            <span class="text-xs text-ink-muted">
              Optional · leave blank to run without a checkout
            </span>
          }
        >
          {(error) => <span class="text-xs text-failure">{error()}</span>}
        </Show>
      </label>
    </>
  );
}
