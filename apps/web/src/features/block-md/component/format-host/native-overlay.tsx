import type { ThreadId } from '@core/comments/commentType';
import { HostedFloatingLinkMenu } from '@core/component/LexicalMarkdown/component/menu/FloatingLinkMenu';
import { FloatingMenuGroup } from '@core/component/LexicalMarkdown/context/FloatingMenuContext';
import { toast } from '@core/component/Toast/Toast';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import type { ViewSelection } from '@macro-inc/lexical-wasm-view/view/types';
import { type Span, Telemetry } from '@macro-inc/observability';
import {
  type Accessor,
  type Component,
  createRoot,
  ErrorBoundary,
  Show,
} from 'solid-js';
import { CommentButton } from '../CommentButton';
import { createNativeAiEditSlot } from './native-ai-edit-slot';
import {
  NativeBodyFormatPopup,
  type NativeBodyPopupComposition,
} from './native-body-popup';
import { createNativeDocumentFormattingObserver } from './native-observer';
import { NativeSnippetLinkControl } from './native-snippet';
import { createNativeBodyTouchActions } from './native-touch-actions';

/** Own only the optional body menu; the document owns its actual native view. */
export function createNativeBodyFormattingOverlay(options: {
  /** The view entry's desktop or touch popup composition. */
  composition: NativeBodyPopupComposition;
  canEdit: Accessor<boolean>;
  alive: Accessor<boolean>;
  /** Copy link to snippet for every viewer of this document. */
  snippetLink?: { readonly documentId: Accessor<string> };
  /** Comment action for editors and commenters. */
  comment?: {
    readonly canComment: Accessor<boolean>;
    /** Source CREATE_DRAFT_COMMENT_COMMAND result. */
    readonly insert: () => boolean;
  };
  /** Touch devices: what Source's TouchSelectionToolbar acts on. */
  touch?: {
    readonly documentId: Accessor<string>;
    /** The mounted native view, if any. */
    readonly view: Accessor<EditorView | undefined>;
    /** Source commentState.highlightedCommentThreads and its activation. */
    readonly comments: {
      readonly highlighted: Accessor<readonly ThreadId[]>;
      activate(thread: ThreadId): void;
      /** Source `$getMarkIdsAtCaret` for a selection of the mounted view. */
      caretCommentIds(selection: ViewSelection): readonly string[] | null;
    };
  };
  /** Source AI edit selection action. */
  aiEdit?: {
    readonly documentId: Accessor<string>;
    readonly view: Accessor<EditorView | undefined>;
    /** The inline-ai-editing flag and canEdit. */
    readonly enabled: Accessor<boolean>;
    /** Source flow.span, the parent of each edit's span. */
    readonly parentSpan: Span;
  };
}) {
  const comment = options.comment;
  const commentAction = comment && {
    canComment: () => options.alive() && comment.canComment(),
    render: (close: () => void) => (
      <CommentButton
        onClick={() => {
          // Source MarkdownPopup.handleInsertComment.
          if (!comment.insert()) {
            toast.failure('Please highlight text to comment.');
            return;
          }
          close();
        }}
      />
    ),
  };
  return createRoot((disposeRoot) => {
    const touchComments = options.touch?.comments;
    const formatting = createNativeDocumentFormattingObserver({
      ...options,
      // Source MarkdownPopup :183-191: on touch, a caret touching a comment.
      allowEmptySelection:
        touchComments &&
        ((selection) => touchComments.caretCommentIds(selection) !== null),
    });
    const aiEdit = options.aiEdit;
    const ai =
      aiEdit &&
      createNativeAiEditSlot({
        ...aiEdit,
        enabled: () => options.alive() && aiEdit.enabled(),
      });
    const touchOptions = options.touch;
    const touch =
      touchOptions &&
      createNativeBodyTouchActions({
        ...touchOptions,
        canEdit: options.canEdit,
        alive: options.alive,
        comment: comment && {
          canComment: () => commentAction?.canComment() ?? false,
          insert: () => comment.insert(),
        },
        snippetLink: () => formatting.snippetLink(),
      });
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      disposeRoot();
    };
    const report = (error: unknown) => {
      try {
        Telemetry.error(error, { surface: 'native-format-menu' });
      } catch {
        // Optional presentation must not replace a document failure.
      }
    };
    const unavailable = (error: unknown) => {
      report(error);
      try {
        dispose();
      } catch (cleanupError) {
        report(cleanupError);
      }
    };
    const Overlay: Component = () => (
      <ErrorBoundary
        fallback={(error: unknown) => {
          unavailable(error);
          return null;
        }}
      >
        <FloatingMenuGroup>
          <Show when={formatting.links()}>
            {(links) => (
              <HostedFloatingLinkMenu
                host={links()}
                autoLinkMatchMode="common-tlds"
              />
            )}
          </Show>
          <Show when={formatting.controller()}>
            {(controller) => (
              <NativeBodyFormatPopup
                composition={options.composition}
                host={controller().host}
                popup={controller().bodyPopup}
                commentAction={commentAction}
                slots={ai ? [ai.slot] : []}
                touch={touch}
                onToolbarClosed={ai?.popupClosed}
                snippetLinkAction={
                  formatting.snippetLink()
                    ? {
                        available: () =>
                          options.alive() &&
                          formatting.snippetLink() !== undefined,
                        render: () => (
                          <Show when={formatting.snippetLink()}>
                            {(link) => (
                              <NativeSnippetLinkControl link={link()} />
                            )}
                          </Show>
                        ),
                      }
                    : undefined
                }
              />
            )}
          </Show>
          {ai?.Highlight()}
          {ai?.Drawer()}
        </FloatingMenuGroup>
      </ErrorBoundary>
    );
    return {
      observer: formatting.observer,
      host: () => formatting.controller()?.host,
      /** Source slash Link: TRY_INSERT_LINK on the actual published view. */
      requestLink() {
        const host = formatting.controller()?.host;
        if (!host) throw new Error('Native link host is unavailable');
        host.requestLink();
      },
      Overlay,
      dispose,
    };
  });
}
