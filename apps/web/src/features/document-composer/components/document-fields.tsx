import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import type { EditorBuilder } from '@core/component/LexicalMarkdown/builder/types';
import type { TagMentionLifecycle } from '@core/component/LexicalMarkdown/plugins/tags';
import type { PortalScope } from '@core/component/ScopedPortal';
import { EntityComposer, Scroll } from '@ui';
import type { Accessor } from 'solid-js';
import { ComposeTaskTitleEditor } from '../../task-composer/components/title-editor';

/** The existing document composer's fields, independent of split navigation and storage. */
export function DocumentFields(props: {
  title: string;
  onTitleChange: (title: string) => void;
  editor: EditorBuilder;
  value?: string;
  initialValue?: string;
  disabled?: boolean;
  bodyLabel?: string;
  containerRef?: Accessor<HTMLDivElement | undefined>;
  titleRef?: (element: HTMLDivElement) => void;
  onTagSelected?: (tag: TagMentionLifecycle) => void;
  onSubmit?: () => void;
  portalScope?: PortalScope;
}) {
  const body = props.editor.buildHandle().lexical;
  return (
    <EntityComposer.Main>
      <EntityComposer.Title>
        <ComposeTaskTitleEditor
          placeholder="New document"
          value={() => props.title}
          onChange={props.onTitleChange}
          disabled={() => !!props.disabled}
          bodyEditor={() => body}
          containerRef={props.containerRef}
          onTagSelected={props.onTagSelected}
          onSubmit={props.onSubmit}
          portalScope={props.portalScope}
          ref={props.titleRef}
        />
      </EntityComposer.Title>
      <EntityComposer.Body>
        <Scroll>
          <MarkdownShell
            config={props.editor}
            value={props.value}
            initialValue={props.initialValue}
            disabled={props.disabled}
            placeholder="Add content..."
            portalScope={props.portalScope}
            ariaLabel={props.bodyLabel ?? 'Document body'}
          />
        </Scroll>
      </EntityComposer.Body>
    </EntityComposer.Main>
  );
}
