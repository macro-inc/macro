import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { For } from 'solid-js';
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
}) {
  const promptEditor = createPromptEditor(props.onSystemPromptChange);

  return (
    <>
      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-medium">Instructions</span>
        {/* The min-height belongs on the shell, not just this box: the shell is
         * `h-full`, which resolves to `auto` under a min-height-only parent, so
         * it would collapse to one line and leave the rest of the box dead to
         * clicks. `overflow-visible` drops its own `overflow-y-auto` — nested
         * inside `SettingsCard`'s `overflow-hidden` it scrolled separately from
         * the page, with `scrollbar-hidden` leaving nothing to grab. */}
        <div class="rounded-md border border-edge-muted px-3 py-2.5 focus-within:border-accent">
          <MarkdownShell
            config={promptEditor}
            placeholder="Describe how this agent should behave, what it should prioritise, and anything it should never do."
            initialValue={props.initialSystemPrompt}
            class="min-h-40 overflow-visible"
          />
        </div>
        <span class="text-xs text-ink-muted">
          Markdown. Prepended to every session this agent runs.
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
    </>
  );
}
