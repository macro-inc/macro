import { HostedFloatingLinkMenu } from '@core/component/LexicalMarkdown/component/menu/FloatingLinkMenu';
import { FloatingMenuGroup } from '@core/component/LexicalMarkdown/context/FloatingMenuContext';
import { toast } from '@core/component/Toast/Toast';
import { Telemetry } from '@macro-inc/observability';
import {
  type Accessor,
  type Component,
  createRoot,
  ErrorBoundary,
  Show,
} from 'solid-js';
import { CommentButton } from '../CommentButton';
import { NativeBodyFormatPopup } from './native-body-popup';
import { createNativeDocumentFormattingObserver } from './native-observer';
import { NativeSnippetLinkControl } from './native-snippet';

/** Own only the optional body menu; the document owns its actual native view. */
export function createNativeBodyFormattingOverlay(options: {
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
    const formatting = createNativeDocumentFormattingObserver(options);
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
                host={controller().host}
                popup={controller().bodyPopup}
                commentAction={commentAction}
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
