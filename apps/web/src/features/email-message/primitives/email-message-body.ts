import { prepareEmailBody } from '@macro-inc/email-renderer';
import { mountEmailBody } from '@macro-inc/email-renderer/browser';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js';
import type { EmailRenderingContextValue } from '../context/email-rendering-context';
import type { EmailMessage } from '../core/email-message';

export interface EmailMessageBodyProps {
  message: EmailMessage;
  isPersonal: boolean;
  isBodyExpanded: Accessor<boolean>;
  setExpandedMessageBody: (id: string) => void;
  setFocusedMessageId: (messageId: string | undefined) => void;
  showFullContent?: boolean;
  isFocused: boolean;
}

/** Solid only translates reactive inputs and owns the renderer's lifetime. */
export function createEmailMessageBody(
  props: EmailMessageBodyProps,
  renderingContext: EmailRenderingContextValue
) {
  const [showFullHTML, setShowFullHTML] = createSignal(false);
  const prepared = createMemo(() =>
    prepareEmailBody(
      {
        html: props.message.body_html_sanitized,
        replylessHtml: props.message.body_replyless,
        text: props.message.body_text,
      },
      {
        showQuotedContent: showFullHTML(),
        showFullContent: props.showFullContent,
        images: renderingContext.images,
      }
    )
  );
  const rendered = createMemo(() => {
    // Preserve the app's existing Markdown paths without starting hidden HTML
    // resources behind them. Their Lexical semantics stay at the app boundary.
    if (
      (!showFullHTML() && props.message.body_macro) ||
      !props.message.body_html_sanitized
    )
      return;
    const body = prepared();
    const attachments = props.message.attachments;
    const host = document.createElement('div');
    const renderer = mountEmailBody(host, body, {
      theme: renderingContext.theme(),
      adaptColors: props.isPersonal || !body.hasTable,
      normalizeFonts:
        props.isPersonal &&
        !props.message.from?.email?.toLowerCase().endsWith('@macro.com'),
      expanded: untrack(props.isBodyExpanded),
      prepareLinks: renderingContext.prepareLinks,
      resolveImages: (root, lifetime) =>
        renderingContext.resolveImages(root, attachments, lifetime),
    });
    onCleanup(() => renderer.dispose());
    return { host, renderer };
  });
  createEffect(() => rendered()?.renderer.setExpanded(props.isBodyExpanded()));
  return {
    showFullHTML,
    setShowFullHTML,
    host: () => rendered()?.host,
    hasHiddenReplyStructure: () => prepared().hasHiddenContent,
  };
}
