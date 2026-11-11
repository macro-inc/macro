import { HostedFloatingFormatMenu } from '@core/component/LexicalMarkdown/component/menu/FloatingFormatMenu';
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
import { createNativeDocumentFormattingObserver } from './native-observer';

/** Own only the optional body menu; the document owns its actual native view. */
export function createNativeBodyFormattingOverlay(options: {
  canEdit: Accessor<boolean>;
  alive: Accessor<boolean>;
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
          <Show when={formatting.controller()}>
            {(controller) => (
              <HostedFloatingFormatMenu
                host={controller().menu}
                options={{
                  showLinkButton: false,
                  ...(commentAction ? { commentAction } : {}),
                }}
              />
            )}
          </Show>
        </FloatingMenuGroup>
      </ErrorBoundary>
    );
    return { observer: formatting.observer, Overlay, dispose };
  });
}
