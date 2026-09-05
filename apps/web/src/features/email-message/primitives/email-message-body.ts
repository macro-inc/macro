import type { EmailMessage } from '@app/features/email-message/core/email-message';
import { parseEmailContent, processEmailColors } from '@core/email';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js';
import type { EmailRenderingDependencies } from '../context/email-rendering-context';
import { EMAIL_BODY_CONTAINMENT_CSS } from '../core/email-body-containment-css';
import { fitToWidthZoom } from '../core/fit-to-width-zoom';
export interface EmailMessageBodyProps {
  message: EmailMessage;
  isPersonal: boolean;
  isBodyExpanded: Accessor<boolean>;
  setExpandedMessageBody: (id: string) => void;
  setFocusedMessageId: (messageID: string | undefined) => void;
  showFullContent?: boolean;
  isFocused: boolean;
}

export function createEmailMessageBody(
  props: EmailMessageBodyProps,
  dependencies: EmailRenderingDependencies
) {
  const [showFullHTML, setShowFullHTML] = createSignal<boolean>(false);
  // If we don't have body replyless, it may be because it hasn't been generated yet. For instance, this is the case immediately after a message is sent. We can use the HTML to parse the message correctly.
  const bodyReplyless = createMemo(() => {
    let replyless = props.message.body_replyless ?? '';
    if (!replyless) {
      if (props.message.body_html_sanitized) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(
          props.message.body_html_sanitized.toString(),
          'text/html'
        );
        const styleTags = Array.from(doc.head?.querySelectorAll('style') ?? [])
          .map((style) => style.outerHTML)
          .join('\n');
        const quoted = doc.body.querySelector('.macro_quote');
        if (quoted) {
          quoted?.remove();
          return styleTags
            ? `${styleTags}\n${doc.body.innerHTML}`
            : doc.body.innerHTML;
        }
      }
    }
    return replyless;
  });

  const isPlaintext = () => !props.message.body_html_sanitized;

  const parsedBodyHtml = createMemo(() => {
    return props.message.body_html_sanitized
      ? parseEmailContent(
          props.message.body_html_sanitized,
          !showFullHTML(),
          !showFullHTML()
        )
      : undefined;
  });

  const parsedBodyReplyless = createMemo(() => {
    const processed = bodyReplyless();
    return processed ? parseEmailContent(processed) : undefined;
  });

  const source = () => {
    return showFullHTML() || props.showFullContent
      ? parsedBodyHtml()
      : parsedBodyReplyless();
  };

  // Sent-from-Macro messages strip the quoted thread from body_macro at send
  // time, and the backend skips replyless trimming for "Fwd:" subjects — so a
  // quote in the full html means there is hidden content regardless of
  // body_replyless.
  const bodyHtmlHasQuote = createMemo(() => {
    const html = props.message.body_html_sanitized;
    if (!html || !props.message.body_macro) return false;
    const doc = new DOMParser().parseFromString(html.toString(), 'text/html');
    return doc.body.querySelector('.macro_quote') !== null;
  });

  const hasHiddenReplyStructure = () => {
    return (
      !isPlaintext() &&
      (bodyHtmlHasQuote() ||
        (bodyReplyless() &&
          bodyReplyless().toString().replace(/\s+/g, '').length !==
            props.message.body_html_sanitized?.toString().replace(/\s+/g, '')
              .length) ||
        source()?.signature)
    );
  };

  const isPersonal = () => props.isPersonal;

  const isMacroSender = createMemo(() => {
    const senderEmail = props.message.from?.email?.toLowerCase();
    return senderEmail?.endsWith('@macro.com') ?? false;
  });

  const host = createMemo(() => {
    dependencies.theme();
    const hostContainer = document.createElement('div');
    const shadow = hostContainer.attachShadow({ mode: 'open' });
    // Style that uses a CSS variable to control image visibility
    const styleEl = document.createElement('style');
    // Normalize font in email
    const fontOverride =
      isPersonal() && !isMacroSender()
        ? `*:not(code):not(pre):not(code *):not(pre *):not([data-macro-btn]){font-family: system-ui, sans-serif !important; font-size: inherit !important; line-height: 1.5 !important;}`
        : '';
    // Containment (images, signatures, quotes, pre/code) lives in
    // EMAIL_BODY_CONTAINMENT_CSS so the snapshot harness stays in lockstep.
    styleEl.textContent = `${EMAIL_BODY_CONTAINMENT_CSS}${fontOverride}`;
    shadow.appendChild(styleEl);
    const messageDiv = document.createElement('div');
    messageDiv.innerHTML = source()?.mainContent ?? '';
    // Mark button-like anchors so the font override doesn't break their sizing
    for (const a of messageDiv.querySelectorAll<HTMLAnchorElement>(
      'a[style]'
    )) {
      if (a.style.backgroundColor) {
        a.dataset.macroBtn = '';
        for (const child of a.querySelectorAll('*')) {
          (child as HTMLElement).dataset.macroBtn = '';
        }
      }
    }
    // Open links in a new tab instead of navigating the current one
    for (const a of messageDiv.querySelectorAll('a[href]')) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
    // Raw mailto: anchors open the in-app composer instead of the OS mail client
    dependencies.prepareLinks?.(messageDiv);
    messageDiv.style.userSelect = 'text';
    // Safari resolves only the -webkit- prefixed form of user-select
    // (unprefixed shipped in Safari 26.4), and WebKit inherits the app-wide
    // `user-select: none` through the shadow boundary — without the prefix,
    // email text isn't selectable in Safari.
    messageDiv.style.setProperty('-webkit-user-select', 'text');
    messageDiv.style.cursor = 'auto';
    shadow.appendChild(messageDiv);
    return hostContainer;
  });

  // Resolve images in two sequential steps, resolving cid urls and then fetching images on tauri via plaformFetch
  createEffect(() => {
    const root = host().shadowRoot;
    if (!root) return;
    const attachments = props.message.attachments;

    const blobUrls: string[] = [];
    let disposed = false;
    onCleanup(() => {
      disposed = true;
      for (const url of blobUrls) URL.revokeObjectURL(url);
    });

    queueMicrotask(async () => {
      if (disposed) return;
      await dependencies.resolveImages(
        root,
        attachments,
        blobUrls,
        () => disposed
      );
    });
  });

  // Process the email colors when: the theme changes, or the source HTML changes.
  createEffect(() => {
    dependencies.theme();
    showFullHTML();
    const root = host().shadowRoot;
    if (root) {
      if (isPersonal() || !source()?.hasTable) {
        queueMicrotask(() => {
          untrack(() => {
            const theme = dependencies.theme();
            processEmailColors(root, theme);
          });
        });
      } else {
        const contentWrapper = root.querySelector('div');
        if (contentWrapper instanceof HTMLElement) {
          contentWrapper.style.setProperty(
            'background-color',
            'white',
            'important'
          );
          // Some emails don't have a color set, so we need to set it to black to ensure text is readable againnst white background
          contentWrapper.style.setProperty('color', 'black');
        }
      }
    }
  });

  // Hide images when the message body is not expanded (via CSS variable)
  createEffect(() => {
    const container = host();
    const shouldHide = !props.isBodyExpanded();
    container.style.setProperty(
      '--macro-email-img-display',
      shouldHide ? 'none' : 'initial'
    );
  });

  // After containment, shrink leftover wide canvases (newsletter tables)
  // to the pane. Pathological width is floored so type stays readable.
  createEffect(() => {
    const container = host();
    // Re-run when source changes
    source();

    const clearScale = () => {
      const root = container.shadowRoot;
      if (!root) return;
      const messageDiv = root.querySelector('div');
      if (messageDiv instanceof HTMLElement) {
        messageDiv.style.zoom = '';
        messageDiv.style.overflow = '';
        messageDiv.style.overflowX = '';
      }
    };

    if (!props.isBodyExpanded()) {
      clearScale();
      return;
    }

    const applyScale = () => {
      const root = container.shadowRoot;
      if (!root) return;
      const messageDiv = root.querySelector('div');
      if (!messageDiv || !(messageDiv instanceof HTMLElement)) return;

      // Reset any previous scaling before measuring. overflowX is a longhand
      // and survives clearing the overflow shorthand.
      messageDiv.style.zoom = '';
      messageDiv.style.overflow = '';
      messageDiv.style.overflowX = '';

      const fit = fitToWidthZoom({
        containerWidth: container.clientWidth,
        contentWidth: messageDiv.scrollWidth,
      });
      if (!fit) {
        // When content fits, leave overflow alone. overflow:auto on a fitting
        // body turns hidden tracking-pixel divs into a message-height scrollbar.
        return;
      }
      // Use zoom instead of transform: scale() so backgrounds, borders, and
      // layout shrink together without clipping. The floor keeps leftover
      // canvas overflow (a 600px newsletter on a skinny pane) readable.
      messageDiv.style.zoom = `${fit.zoom}`;
      if (fit.overflowsAfterZoom) {
        messageDiv.style.overflowX = 'auto';
      }
    };

    // Re-run on container resize (e.g. orientation change, split resize)
    const resizeObserver = new ResizeObserver(() => applyScale());
    resizeObserver.observe(container);

    // Re-run when images inside the shadow DOM finish loading
    const root = container.shadowRoot;
    const images = root ? Array.from(root.querySelectorAll('img')) : [];
    const onImageLoad = () => applyScale();
    for (const img of images) {
      if (!img.complete) {
        img.addEventListener('load', onImageLoad);
      }
    }

    // Initial measurement after layout
    const measureFrame = requestAnimationFrame(() => applyScale());

    onCleanup(() => {
      cancelAnimationFrame(measureFrame);
      resizeObserver.disconnect();
      for (const img of images) {
        img.removeEventListener('load', onImageLoad);
      }
    });
  });

  return {
    isPersonal,
    showFullHTML,
    setShowFullHTML,
    isPlaintext,
    host,
    hasHiddenReplyStructure,
  };
}
