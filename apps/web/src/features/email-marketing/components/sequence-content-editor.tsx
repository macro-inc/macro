import { CollabMarkdownEditor } from '@core/collab-surface/CollabMarkdownEditor';
import { SyncSourceStatus } from '@macro-inc/collaboration/collab/source';
import {
  $getRoot,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
} from 'lexical';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
  untrack,
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

function ContentSession(props: Props & { onRetry(): void }) {
  const session = props.composition.createSession(props.options);
  const [ready, setReady] = createSignal(false);
  const [editor, setEditor] = createSignal<LexicalEditor>();
  const [editorFailed, setEditorFailed] = createSignal(false);
  props.onState('loading');
  onCleanup(() => {
    session.dispose();
  });
  const read = () => {
    const lexical = editor();
    if (!ready() || !lexical) return;
    const text = lexical
      .getEditorState()
      .read(() => $getRoot().getTextContent());
    if (text !== props.options.initialText) props.onChange(text);
  };
  // Connection errors are external state; keep the parent activation gate informed.
  createEffect(
    on(session.connectionError, (error) => {
      if (error) props.onState('error');
    })
  );
  return (
    <div class="relative">
      <CollabMarkdownEditor
        sourceId={session.sourceId}
        session={session}
        namespace={`sequence-${props.options.field}`}
        label={props.label}
        canEdit={() => !props.disabled}
        canComment={() => false}
        class={
          props.options.field === 'body'
            ? 'min-h-36 text-sm leading-6'
            : 'min-h-6 text-sm [&_p]:m-0'
        }
        placeholder={
          props.options.field === 'body'
            ? 'Hi {{firstName}},'
            : 'A subject worth opening'
        }
        onControls={(controls) => {
          const lexical = controls.getLexical();
          setEditor(lexical);
          onCleanup(lexical.registerUpdateListener(read));
          if (props.options.field === 'subject')
            onCleanup(
              lexical.registerCommand(
                KEY_ENTER_COMMAND,
                (event) => {
                  if (controls.isInlineMenuOpen()) return false;
                  event?.preventDefault();
                  return true;
                },
                COMMAND_PRIORITY_HIGH
              )
            );
        }}
        onReady={() => {
          setReady(true);
          untrack(() => {
            read();
            props.onState('ready');
          });
        }}
        onError={() => {
          setEditorFailed(true);
          props.onState('error');
        }}
      />
      <Show when={ready() && !session.connectionError() && !editorFailed()}>
        <p class="mt-2 text-[10px] text-ink-subtle">
          {session.syncSource()?.status() === SyncSourceStatus.Connected
            ? 'Shared draft'
            : 'Offline · changes queued'}
        </p>
      </Show>
      <Show when={session.connectionError() || editorFailed()}>
        <button
          type="button"
          aria-label="Retry shared content"
          class="mt-2 text-xs text-accent hover:underline"
          onClick={props.onRetry}
        >
          Retry shared content
        </button>
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
