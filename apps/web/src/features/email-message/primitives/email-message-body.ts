import { deepEqual } from '@core/util/compareUtils';
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
  /** Load Macro read-receipt pixels, so viewing this copy counts as an open. */
  showReadReceiptPixel?: boolean;
}

/** Solid only translates reactive inputs and owns the renderer's lifetime. */
export function createEmailMessageBody(
  props: EmailMessageBodyProps,
  renderingContext: EmailRenderingContextValue
) {
  const [showFullHTML, setShowFullHTML] = createSignal(false);
  const pixels = renderingContext.readReceiptPixels ?? [];
  // Pixels stay hidden while ownership is unknown. Only a body that carries one
  // re-renders when it may show, so other bodies keep their image resources.
  const hiddenPixels = () => {
    const { body_html_sanitized: html, body_replyless: replyless } =
      props.message;
    const carriesPixel = pixels.some(
      (prefix) => html?.includes(prefix) || replyless?.includes(prefix)
    );
    return props.showReadReceiptPixel && carriesPixel ? [] : pixels;
  };
  // Thread refreshes replace message objects after every draft save. Only
  // changes to rendering inputs should dispose the body and its image resources.
  const content = createMemo(
    () => ({
      id: props.message.db_id,
      html: props.message.body_html_sanitized,
      replylessHtml: props.message.body_replyless,
      text: props.message.body_text,
      macro: props.message.body_macro,
      attachments: props.message.attachments,
      isPersonal: props.isPersonal,
      showFullContent: props.showFullContent,
      normalizeFonts:
        props.isPersonal &&
        !props.message.from?.email?.toLowerCase().endsWith('@macro.com'),
      hiddenPixels: hiddenPixels(),
    }),
    undefined,
    { equals: deepEqual }
  );
  const prepared = createMemo(() => {
    const images = renderingContext.images;
    return prepareEmailBody(content(), {
      showQuotedContent: showFullHTML(),
      showFullContent: content().showFullContent,
      images: images && {
        ...images,
        hiddenUrlPrefixes: content().hiddenPixels,
      },
    });
  });
  const rendered = createMemo(() => {
    // Preserve the app's existing Markdown paths without starting hidden HTML
    // resources behind them. Their Lexical semantics stay at the app boundary.
    if ((!showFullHTML() && content().macro) || !content().html) return;
    const body = prepared();
    const attachments = content().attachments;
    const host = document.createElement('div');
    // Keep the renderer at pane width so wide designed email scrolls within it.
    host.style.minWidth = '0';
    host.style.width = '100%';
    const renderer = mountEmailBody(host, body, {
      theme: renderingContext.theme(),
      adaptColors: content().isPersonal || !body.hasTable,
      normalizeFonts: content().normalizeFonts,
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
