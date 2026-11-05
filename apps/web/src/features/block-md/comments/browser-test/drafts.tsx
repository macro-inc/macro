import '@app/index.css';
import {
  COMMIT_COMMENT_MARK_COMMAND,
  CREATE_DRAFT_COMMENT_COMMAND,
  commentPlugin,
  DELETE_COMMENT_COMMAND,
  DISCARD_DRAFT_COMMENT_COMMAND,
} from '@core/component/LexicalMarkdown/plugins/comments/commentPlugin';
import {
  $createCommentNode,
  CommentNode,
  peerIdPlugin,
  stripDraftCommentMarks,
} from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { CommentButton } from '../../component/CommentButton';

function Fixture() {
  const readonly = new URLSearchParams(location.search).has('readonly');
  const [focused, setFocused] = createSignal(false);
  const [draftId, setDraftId] = createSignal<string>();
  const [result, setResult] = createSignal('');
  const [saved, setSaved] = createSignal('');
  const editor = createEditor({
    namespace: 'comment-drafts',
    nodes: [CommentNode],
    onError: (error) => {
      throw error;
    },
  });
  let root!: HTMLDivElement;
  onMount(() => {
    editor.setRootElement(root);
    editor.setEditable(!readonly);
    const cleanupPeer = peerIdPlugin({
      peerId: () => '1',
      nodes: [CommentNode],
    })(editor);
    const cleanupComments = commentPlugin({
      peerId: () => '1',
      documentId: 'comment-fixture',
      ops: {
        add: (id, _node, _element, _saved, draft, local) => {
          if (draft && local) setDraftId(id);
        },
        remove: (id, _key, last) => {
          if (last && id === draftId()) setDraftId(undefined);
        },
        init: () => {},
        setActiveIds: () => {},
      },
    })(editor);
    const cleanupUpdates = editor.registerUpdateListener(({ editorState }) => {
      setSaved(JSON.stringify(stripDraftCommentMarks(editorState.toJSON())));
    });
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append(
            $createCommentNode({ ids: ['saved-comment'] }).append(
              $createTextNode('Already commented text')
            )
          ),
          $createParagraphNode().append(
            $createTextNode('Plain text for another comment')
          )
        );
      },
      { discrete: true }
    );
    onCleanup(() => {
      cleanupUpdates();
      cleanupComments();
      cleanupPeer();
      editor.setRootElement(null);
    });
  });
  const cancel = () => {
    const id = draftId();
    if (id) editor.dispatchCommand(DELETE_COMMENT_COMMAND, [id, false]);
    editor.dispatchCommand(DISCARD_DRAFT_COMMENT_COMMAND, undefined);
    setDraftId(undefined);
  };
  return (
    <main class="bg-page text-ink p-6 space-y-4">
      <h1>Inline comment regression</h1>
      <div
        ref={root}
        contentEditable={!readonly}
        role="textbox"
        aria-label="Document"
        class="border border-edge p-4 min-h-32"
        onFocusIn={() => setFocused(true)}
        onFocusOut={() => setFocused(false)}
      />
      <CommentButton
        disabled={!readonly && !focused()}
        onClick={() =>
          setResult(
            String(
              editor.dispatchCommand(CREATE_DRAFT_COMMENT_COMMAND, undefined)
            )
          )
        }
      />
      <button onClick={cancel}>Cancel draft</button>
      <button
        onClick={() => {
          const id = draftId();
          if (id)
            editor.dispatchCommand(COMMIT_COMMENT_MARK_COMMAND, { markId: id });
          setDraftId(undefined);
        }}
      >
        Commit mark
      </button>
      <output data-testid="result">{result()}</output>
      <output data-testid="draft">{draftId() ?? ''}</output>
      <pre data-testid="saved" class="whitespace-pre-wrap break-all">
        {saved()}
      </pre>
    </main>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
