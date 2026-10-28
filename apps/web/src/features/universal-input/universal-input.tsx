import { useSplitLayout } from '@components/app/split-layout/layout';
import type {
  ReferredFrom,
  SplitContent,
} from '@components/app/split-layout/layoutManager';
import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import type { PromptSubmitSurface } from '@core/agent-session/prompt-telemetry';
import { buildChatEditor } from '@core/component/AI/component/input/buildChatEditor';
import {
  ChatInputProvider,
  useChatInputContext,
} from '@core/component/AI/context';
import { useGetChatAttachmentInfo } from '@core/component/AI/signal/attachment';
import { createMentionAttachmentCallbacks } from '@core/component/AI/signal/mention-attachment-callbacks';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js';
import { openEntityInSplitFromUnifiedList } from '../next-soup/utils';
import { createInputActions } from './actions';
import { DraftEditor } from './components/draft-editor';
import type { InputSession } from './context/input-session';
import type { InputSurface } from './context/telemetry';
import { emptyDraft, fieldsSchema } from './core/input';
import { createInferenceSource } from './inference';
import {
  createUniversalInput,
  type UniversalInputController,
} from './primitives/universal-input';
import { TaskFields } from './task-fields';
import { createInputTelemetry } from './telemetry';
import { SearchDraft } from './views/search-draft';
import { UniversalComposer } from './views/universal-composer';

function InputContent(props: {
  userId: string;
  navigate: (content: SplitContent) => void;
  session: InputSession;
  referredFrom: ReferredFrom;
  surface: InputSurface;
  submitSurface: PromptSubmitSurface;
}) {
  const session = props.session;
  const chat = useChatInputContext();
  const surface = props.surface;
  const telemetry = createInputTelemetry(surface);
  onCleanup(telemetry.dispose);
  const [state, setState] = createSignal<UniversalInputController>();
  const { getAttachmentFromMention } = useGetChatAttachmentInfo();
  const resolveAppLink = useMacroMentionLinkResolver();
  const editor = buildChatEditor()
    .withAppLinkResolver(resolveAppLink)
    .withMentions({
      ...createMentionAttachmentCallbacks(
        chat.attachments,
        getAttachmentFromMention
      ),
      block: 'chat',
      showOpenTabs: true,
    });
  const actions = createInputActions(
    () => state()?.fields() ?? fieldsSchema.parse({}),
    props.userId,
    {
      navigate: props.navigate,
      onNoteTagsChange: (value) => state()?.edit('noteTags', value),
      submitSurface: props.submitSurface,
      referredFrom: props.referredFrom,
    }
  );
  const inference = createInferenceSource(
    actions.taskDefinitions,
    surface,
    telemetry.parent
  );
  onCleanup(inference.dispose);
  const controller = createUniversalInput({
    ...inference,
    initialDraft: {
      ...emptyDraft(),
      text: session.text,
      intent: session.intent,
    },
    ...actions,
    observe: telemetry.observe,
    submit: (input) => telemetry.run(() => actions.submit(input)),
    saveEmailDraft: (input) =>
      telemetry.run(() => actions.saveEmailDraft(input)),
    onSubmitted: () => {
      const open = state()?.result()?.open;
      session.onComplete();
      open?.();
    },
  });
  setState(controller);
  createEffect(controller.observeReady);
  createEffect(() => session.onSendingChange?.(controller.sending()));
  session.captureControls?.({
    submit: controller.submit,
    ready: () =>
      !controller.sending() &&
      !controller.pending() &&
      !controller.validation(),
  });
  onCleanup(() => {
    session.onSendingChange?.(false);
    session.captureControls?.(undefined);
  });
  createEffect(
    on(
      () => session.text,
      (text) => {
        if (text !== controller.draft().text) controller.setText(text);
      }
    )
  );
  return (
    <UniversalComposer
      state={controller}
      layout={session.layout}
      actions={{ ...actions, resolveAppLink }}
      noteTags={actions.noteTags.composerTags}
      search={(scopeId) => (
        <SearchDraft
          state={controller}
          actions={actions}
          scopeId={scopeId}
          canHandleKeyboard={() => !editor.controls.isInlineMenuOpen()}
          onOpen={(entity, newSplit, location) => {
            session.onNavigate();
            fireAndForget(
              openEntityInSplitFromUnifiedList(entity, {
                openInNewSplit: newSplit,
                location,
                referredFrom: props.referredFrom,
              }),
              'universal-input'
            );
          }}
        />
      )}
      editor={
        session.editor !== undefined ? (
          session.editor
        ) : (
          <DraftEditor
            config={editor}
            text={controller.draft().text}
            disabled={controller.sending()}
            onChange={(text) => {
              if (controller.sending()) return;
              controller.setText(text);
              session.onTextChange(text);
            }}
            initialSelection={session.selection}
            onSubmit={() =>
              fireAndForget(controller.submit(), 'universal-input')
            }
          />
        )
      }
      taskFields={
        <Show when={controller.draft().intent === 'task'}>
          <TaskFields
            disabled={controller.sending()}
            values={actions.taskValues(controller.fields()).values}
            value={controller.fields().taskProperties}
            onChange={(value) => controller.edit('taskProperties', value)}
          />
        </Show>
      }
    />
  );
}

function UniversalInputSession(props: {
  session: InputSession;
  referredFrom: ReferredFrom;
  surface: InputSurface;
  submitSurface: PromptSubmitSurface;
}) {
  const userId = useUserId();
  const { openWithSplit } = useSplitLayout();
  return (
    <ChatInputProvider>
      <Show when={userId()} keyed>
        {(id) => (
          <InputContent
            userId={id}
            session={props.session}
            referredFrom={props.referredFrom}
            surface={props.surface}
            submitSurface={props.submitSurface}
            navigate={(content) => {
              props.session.onNavigate();
              openWithSplit(content, { referredFrom: props.referredFrom });
            }}
          />
        )}
      </Show>
    </ChatInputProvider>
  );
}

/** A transient Command K session with host-owned navigation. */
export function CommandUniversalInput(props: InputSession) {
  return (
    <UniversalInputSession
      session={props}
      referredFrom="kommand-menu"
      surface="command-menu"
      submitSurface="other"
    />
  );
}

/** Mobile Search keeps its dock editor mounted while forms load above it. */
export function MobileUniversalInput(props: InputSession) {
  return (
    <UniversalInputSession
      session={props}
      referredFrom="search"
      surface="mobile-search"
      submitSurface="other"
    />
  );
}

/**
 * A channel composer promoting its own draft, with the message editor still
 * mounted below the form and still able to send the draft as a message.
 */
export function ChannelUniversalInput(props: InputSession) {
  return (
    <UniversalInputSession
      session={props}
      referredFrom="channels"
      surface="channel"
      submitSurface="other"
    />
  );
}
