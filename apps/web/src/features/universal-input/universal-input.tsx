import { useChatInputContext } from '@core/component/AI/context';
import { useUserId } from '@core/context/user';
import { createEffect, createSignal, Show, Suspense } from 'solid-js';
import { createInputActions } from './actions';
import { fieldsSchema } from './core/input';
import { createInferenceSource } from './inference';
import {
  createUniversalInput,
  type UniversalInputController,
} from './primitives/universal-input';
import { TaskFields } from './task-fields';
import { UniversalComposer } from './views/universal-composer';

function InputContent(props: { userId: string }) {
  const chat = useChatInputContext();
  const [state, setState] = createSignal<UniversalInputController>();
  let editor: HTMLTextAreaElement | undefined;
  const actions = createInputActions(
    () => state()?.fields() ?? fieldsSchema.parse({}),
    props.userId
  );
  const controller = createUniversalInput({
    ...createInferenceSource(props.userId),
    ...actions,
  });
  setState(controller);
  // Bridge the existing Home suggestion bus into this editor; this is an external input source.
  createEffect(() => {
    const text = chat.pendingDraft();
    if (text == null) return;
    chat.setPendingDraft(null);
    controller.setText(text);
    controller.choose('ai');
    editor?.focus();
  });
  return (
    <UniversalComposer
      state={controller}
      actions={actions}
      registerEditor={(value) => {
        editor = value;
      }}
      taskFields={
        <Show when={controller.draft().intent === 'task'}>
          <TaskFields
            userId={props.userId}
            value={controller.fields().taskProperties}
            onChange={(value) => controller.edit('taskProperties', value)}
          />
        </Show>
      }
    />
  );
}

export function UniversalInput() {
  const userId = useUserId();
  return (
    <Suspense
      fallback={<div class="min-h-24 rounded-xl border border-edge-muted" />}
    >
      <Show when={userId()} keyed>
        {(id) => <InputContent userId={id} />}
      </Show>
    </Suspense>
  );
}
