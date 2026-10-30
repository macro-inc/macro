import {
  type CollabMarkdownControls,
  CollabMarkdownEditor,
} from '@core/collab-surface/CollabMarkdownEditor';
import { SyncSourceStatus } from '@macro-inc/collaboration/collab/source';
import { Button } from '@ui';
import { $getRoot, COMMAND_PRIORITY_HIGH, KEY_ENTER_COMMAND } from 'lexical';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import type {
  MarketingCapabilities,
  SequenceContentOptions,
} from '../context/contracts';

export type CompositionState = 'loading' | 'ready' | 'error';
type Props = {
  composition: NonNullable<MarketingCapabilities['composition']>;
  options: SequenceContentOptions;
  label: string;
  disabled: boolean;
  onChange(text: string): void;
  onState(state: CompositionState): void;
};

const MARKDOWN_SPECIALS = /[\\`*_~[\]#<>|!+\-.(){}]/g;
const MARKDOWN_ESCAPES = /\\([\\`*_~[\]#<>|!+\-.(){}])/g;

/**
 * Stored subjects and bodies are the plain text we send. The editor seeds from
 * markdown, so escape it: a literal `*`, `_` or `#` must not become formatting.
 */
function escapeMarkdown(text: string) {
  return text.replace(MARKDOWN_SPECIALS, '\\$&');
}

/** Markdown export escapes literal punctuation; the plain-text email must not. */
function unescapeMarkdown(markdown: string) {
  return markdown.replace(MARKDOWN_ESCAPES, '$1');
}

/** Ignore serializer-only differences (line endings, trailing space, blank runs). */
function normalizeText(text: string) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Plain-text email: subjects stay on one line, bodies keep URLs and list markers. */
function serialize(
  controls: CollabMarkdownControls,
  field: SequenceContentOptions['field']
) {
  if (field === 'body') return unescapeMarkdown(controls.getMarkdown());
  return controls
    .getLexical()
    .getEditorState()
    .read(() => $getRoot().getTextContent())
    .replace(/[\r\n]+/g, ' ');
}

/** Stops file, entity, and text drops: sequence fields are plain-text email. */
function blockDrop(event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
}

function ContentSession(props: Props & { onRetry(): void }) {
  const field = props.options.field;
  const session = props.composition.createSession({
    ...props.options,
    initialText: escapeMarkdown(props.options.initialText),
  });
  const [editorReady, setEditorReady] = createSignal(false);
  const [editorFailed, setEditorFailed] = createSignal(false);
  const [controls, setControls] = createSignal<CollabMarkdownControls>();
  onCleanup(() => {
    session.dispose();
  });
  const failed = () => editorFailed() || !!session.connectionError();
  const connected = () =>
    session.syncSource()?.status() === SyncSourceStatus.Connected;
  // Ready only once the editor holds the shared content over a live socket,
  // so Save and Activate never snapshot a failed or offline load.
  const state = createMemo<CompositionState>(() => {
    if (failed()) return 'error';
    return editorReady() && connected() ? 'ready' : 'loading';
  });
  const read = () => {
    const handle = controls();
    if (!editorReady() || failed() || !handle) return;
    const text = serialize(handle, field);
    if (normalizeText(text) !== normalizeText(props.options.initialText))
      props.onChange(text);
  };
  // The parent's Save/Activate gate is external state; flush content before
  // reporting ready so the campaign draft already holds the shared copy.
  createEffect(
    on(state, (next) => {
      if (next === 'ready') read();
      props.onState(next);
    })
  );
  return (
    <div
      class="relative"
      ref={(element) => {
        // Capture phase, so the editor's own drop handlers never see the drag.
        for (const type of ['dragenter', 'dragover', 'drop'] as const)
          element.addEventListener(type, blockDrop, { capture: true });
      }}
    >
      <CollabMarkdownEditor
        sourceId={session.sourceId}
        session={session}
        namespace={`sequence-${field}`}
        label={props.label}
        canEdit={() => !props.disabled}
        canComment={() => false}
        class={
          field === 'body'
            ? 'min-h-36 text-sm leading-6'
            : 'min-h-6 text-sm [&_p]:m-0'
        }
        placeholder={
          field === 'body' ? 'Hi {{firstName}},' : 'A subject worth opening'
        }
        onControls={(handle) => {
          setControls(handle);
          const lexical = handle.getLexical();
          onCleanup(lexical.registerUpdateListener(read));
          if (field === 'subject')
            onCleanup(
              lexical.registerCommand(
                KEY_ENTER_COMMAND,
                (event) => {
                  if (handle.isInlineMenuOpen()) return false;
                  event?.preventDefault();
                  return true;
                },
                COMMAND_PRIORITY_HIGH
              )
            );
        }}
        onReady={() => setEditorReady(true)}
        onError={() => setEditorFailed(true)}
      />
      <Show when={editorReady() && !failed()}>
        <p class="mt-2 text-[10px] text-ink-subtle">
          {connected() ? 'Shared draft' : 'Offline · changes queued'}
        </p>
      </Show>
      <Show when={failed()}>
        <Button
          type="button"
          variant="link"
          size="xs"
          class="mt-2"
          aria-label="Retry shared content"
          onClick={() => props.onRetry()}
        >
          Retry shared content
        </Button>
      </Show>
    </div>
  );
}

/** Keep a live editor mounted while campaign snapshots change on every keystroke. */
export function SequenceContentEditor(props: Props) {
  const [attempt, setAttempt] = createSignal(0);
  const identity = createMemo(
    () => ({
      key: JSON.stringify([
        props.options.databaseId,
        props.options.campaignId,
        props.options.stepId,
        props.options.field,
      ]),
      attempt: attempt(),
    }),
    undefined,
    {
      equals: (previous, next) =>
        previous.key === next.key && previous.attempt === next.attempt,
    }
  );
  return (
    <Show when={identity()} keyed>
      {(identity) => (
        <ContentSession
          {...props}
          onRetry={() => setAttempt(identity.attempt + 1)}
        />
      )}
    </Show>
  );
}
