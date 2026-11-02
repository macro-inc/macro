import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import { fireAndForget } from '@core/util/fireAndForget';
import { EntityComposer } from '@ui';
import type { LexicalEditor } from 'lexical';
import { createSignal, type JSX } from 'solid-js';
import { ComposeTaskTitleEditor } from '../../task-composer/components/title-editor';
import type { UniversalInputController } from '../primitives/universal-input';

/** The task composer's title, Markdown description and property slots. */
export function TaskDraft(props: {
  state: UniversalInputController;
  properties: JSX.Element;
}) {
  const s = props.state;
  const [bodyEditor, setBodyEditor] = createSignal<LexicalEditor>();
  let container: HTMLDivElement | undefined;
  return (
    <div ref={container} tabIndex={-1} class="min-w-0">
      <EntityComposer.Title>
        <ComposeTaskTitleEditor
          value={() => s.fields().title}
          onChange={(value) => s.edit('title', value)}
          onSubmit={() => fireAndForget(s.submit(), 'universal-input')}
          disabled={s.sending}
          bodyEditor={bodyEditor}
          containerRef={() => container}
          portalScope="local"
        />
      </EntityComposer.Title>
      <EntityComposer.Body>
        <MarkdownTextarea
          value={s.fields().body}
          onChange={(value) => {
            if (value !== s.fields().body) s.edit('body', value);
          }}
          editable={() => !s.sending()}
          captureEditor={setBodyEditor}
          placeholder="Add description..."
          domRef={(element) =>
            element.setAttribute('aria-label', 'Description')
          }
          floatingFormatMenu
          portalScope="local"
          class="h-auto min-h-24 [&>[contenteditable]]:min-h-24"
          onEnter={(event) => {
            if (!(event.metaKey || event.ctrlKey) || event.isComposing)
              return false;
            fireAndForget(s.submit(), 'universal-input');
            return true;
          }}
        />
      </EntityComposer.Body>
      {props.properties}
    </div>
  );
}
