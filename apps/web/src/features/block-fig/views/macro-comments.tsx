/**
 * The design's comment store in the app: Macro comments, shown and written
 * with the shared message thread, composer, and discussion that markdown,
 * PDF, and spreadsheet comments use (replies, reactions, edits, mentions,
 * attachments, and copied links). A `comment_id` link opens its comment.
 */

import { ChannelInput } from '@channel/Input';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  useParamNavigationCount,
  useUrlParams,
} from '@core/component/ParamsProvider';
import { toast } from '@core/component/Toast/Toast';
import { COMMENT_LINK_PARAM } from '@core/messages/comment-link';
import { EntityDiscussion } from '@core/messages/EntityDiscussion';
import { MessageThread } from '@core/messages/MessageThread';
import { buildSimpleEntityUrl } from '@core/util/url';
import { useMessageLink } from '@queries/messages/document-messages';
import { type Accessor, createMemo, createSignal, Show } from 'solid-js';
import type {
  FigCommentComposerProps,
  FigCommentStore,
} from '../context/fig-comments';
import { figAnchor, useFigCommentSource } from '../queries/fig-comments';

export function useMacroComments(options: {
  documentId: string;
  userId: Accessor<string | undefined>;
  canComment: Accessor<boolean>;
  /** Delete other people's comments (the document's owner). */
  canModerate: Accessor<boolean>;
  displayName: (userId: string) => string;
}): FigCommentStore {
  const source = useFigCommentSource(options);
  const entity = { type: 'fig', id: options.documentId };
  const buildLink = (message: { id: string }) =>
    buildSimpleEntityUrl(entity, { [COMMENT_LINK_PARAM]: message.id });

  const params = useUrlParams({ commentId: COMMENT_LINK_PARAM });
  const navigation = useParamNavigationCount(COMMENT_LINK_PARAM);
  const target = useMessageLink(source.parent, params.commentId);
  /** Once per followed link, when its thread is known. */
  const linked = createMemo(
    () => {
      const rootId = target.rootId();
      if (!params.commentId() || !rootId || !source.loaded()) return undefined;
      const root = source.root(rootId);
      return {
        key: navigation(),
        threadId: root && figAnchor(root.state.anchor) ? rootId : null,
      };
    },
    undefined,
    { equals: (a, b) => a?.key === b?.key && a?.threadId === b?.threadId }
  );
  // Clicking the linked comment releases its highlight until the next link.
  const [cleared, setCleared] = createSignal<number>();
  const targetIn = (threadId: string | null) => {
    const link = linked();
    return link && link.threadId === threadId && cleared() !== link.key
      ? target.messageId()
      : null;
  };
  const clearTarget = () => setCleared(linked()?.key);

  const Thread = (props: { threadId: string }) => (
    <StaticMarkdownContext>
      <Show when={source.root(props.threadId)}>
        {(root) => (
          <MessageThread
            data={root()}
            canWrite={options.canComment()}
            canModerate={options.canModerate()}
            targetId={targetIn(props.threadId)}
            onClearTarget={clearTarget}
            buildLink={buildLink}
            expanded
            monorail
          />
        )}
      </Show>
    </StaticMarkdownContext>
  );

  const Composer = (props: FigCommentComposerProps) => (
    <StaticMarkdownContext>
      <ChannelInput
        parent={source.parent()}
        flat
        input={{ mode: 'reply', placeholder: 'Add a comment...' }}
        onClose={() => props.onCancel()}
        onEscape={() => props.onCancel()}
        onSendError={() => toast.failure('Could not post the comment')}
        onSend={async (snapshot) => {
          props.onPosted(await source.post(props.anchor, snapshot));
        }}
      />
    </StaticMarkdownContext>
  );

  const Discussion = () => (
    <StaticMarkdownContext>
      <EntityDiscussion
        parent={source.parent()}
        canWrite={options.canComment()}
        canModerate={options.canModerate()}
        link={entity}
        targetId={targetIn(null)}
        label="Discussion"
      />
    </StaticMarkdownContext>
  );

  return {
    threads: source.threads,
    me: () => {
      const id = options.userId();
      return id ? { id, name: options.displayName(id) } : undefined;
    },
    canComment: options.canComment,
    seenAt: source.seenAt,
    markSeen: source.markSeen,
    setResolved: source.setResolved,
    Thread,
    Composer,
    Discussion,
    linked,
  };
}
