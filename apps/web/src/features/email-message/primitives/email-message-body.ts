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
import type { EmailRenderingDependencies } from '../context/email-rendering-context';
import type { EmailMessage } from '../core/email-message';

export interface EmailMessageBodyProps {
  message: EmailMessage;
  isPersonal: boolean;
  isBodyExpanded: Accessor<boolean>;
  setExpandedMessageBody: (id: string) => void;
  setFocusedMessageId: (messageID: string | undefined) => void;
  showFullContent?: boolean;
  isFocused: boolean;
}

/** Solid only translates reactive inputs and owns the renderer's lifetime. */
export function createEmailMessageBody(
  props: EmailMessageBodyProps,
  dependencies: EmailRenderingDependencies
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
        images: dependencies.images,
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
      theme: dependencies.theme(),
      adaptColors: props.isPersonal || !body.hasTable,
      normalizeFonts:
        props.isPersonal &&
        !props.message.from?.email?.toLowerCase().endsWith('@macro.com'),
      expanded: untrack(props.isBodyExpanded),
      prepareLinks: dependencies.prepareLinks,
      resolveImages: (root, lifetime) =>
        dependencies.resolveImages(root, attachments, lifetime),
    });
    onCleanup(() => renderer.dispose());
    return { host, renderer };
  });
  createEffect(() => rendered()?.renderer.setExpanded(props.isBodyExpanded()));
  return {
    isPersonal: () => props.isPersonal,
    showFullHTML,
    setShowFullHTML,
    host: () => rendered()?.host,
    hasHiddenReplyStructure: () => prepared().hasHiddenContent,
  };
}
