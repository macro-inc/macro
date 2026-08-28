import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { useEmail } from '@core/context/user';
import {
  parseEmailContent,
  parseEmailHtmlStructure,
  processEmailColors,
  type ThemeColorParams,
} from '@core/email';
import { interceptMailtoLinks } from '@core/util/interceptMailtoLinks';
import DotsThree from '@phosphor/dots-three.svg';
import type { ApiMessage } from '@service-email/generated/schemas';
import { Button, cn } from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack,
} from 'solid-js';
import { themeReactive } from '../../theme/signals/themeReactive';
import { themeUpdate } from '../../theme/signals/themeSignals';
import { EMAIL_BODY_CONTAINMENT_CSS } from '../util/emailBodyContainmentCss';
import { fitToWidthZoom } from '../util/fitToWidthZoom';
import { isPersonalMessage } from '../util/isPersonalMessage';
import {
  fetchImagesViaPlatform,
  resolveCidImages,
} from '../util/resolveEmailImages';

interface EmailMessageBodyProps {
  message: ApiMessage;
  /** Sender emails (lowercased) with a CATEGORY_PERSONAL message in the thread */
  personalSenders: Accessor<Set<string>>;
  isBodyExpanded: Accessor<boolean>;
  setExpandedMessageBody: (id: string) => void;
  setFocusedMessageId: (messageID: string | undefined) => void;
  isFirstMessageInThread: boolean;
  isFocused: boolean;
}

function scheduleAfterFirstPaint(fn: () => void) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(fn, { timeout: 120 });
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

function personalFontOverrideCss(isPersonal: boolean, isMacroSender: boolean) {
  return isPersonal && !isMacroSender
    ? `*:not(code):not(pre):not(code *):not(pre *):not([data-macro-btn]){font-family: system-ui, sans-serif !important; font-size: inherit !important; line-height: 1.5 !important;}`
    : '';
}

function populateMessageDiv(
  messageDiv: HTMLDivElement,
  html: string,
  isPersonal: boolean,
  isMacroSender: boolean
) {
  messageDiv.innerHTML = html;
  for (const a of messageDiv.querySelectorAll<HTMLAnchorElement>('a[style]')) {
    if (a.style.backgroundColor) {
      a.dataset.macroBtn = '';
      for (const child of a.querySelectorAll('*')) {
        (child as HTMLElement).dataset.macroBtn = '';
      }
    }
  }
  for (const a of messageDiv.querySelectorAll('a[href]')) {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  }
  interceptMailtoLinks(messageDiv);
  messageDiv.style.userSelect = 'text';
  messageDiv.style.setProperty('-webkit-user-select', 'text');
  messageDiv.style.cursor = 'auto';

  const root = messageDiv.getRootNode();
  if (root instanceof ShadowRoot) {
    const styleEl = root.querySelector<HTMLStyleElement>(
      'style[data-macro-email-body]'
    );
    if (styleEl) {
      styleEl.textContent = `${EMAIL_BODY_CONTAINMENT_CSS}${personalFontOverrideCss(isPersonal, isMacroSender)}`;
    }
  }
}

export function EmailMessageBody(props: EmailMessageBodyProps) {
  const [showFullHTML, setShowFullHTML] = createSignal<boolean>(false);
  const userEmail = useEmail();
  const [hostContainer, setHostContainer] = createSignal<HTMLDivElement>();
  const [messageDiv, setMessageDiv] = createSignal<HTMLDivElement>();

  if (DEV_MODE_ENV) {
    console.log(
      'labels',
      props.message.labels.map((l) => l.name)
    );
  }

  const htmlStructure = createMemo(() => {
    const html = props.message.body_html_sanitized?.toString();
    if (!html) return undefined;
    if (props.message.body_replyless && !props.message.body_macro) {
      return undefined;
    }
    return parseEmailHtmlStructure(html);
  });

  const bodyReplyless = createMemo(() => {
    const fromBackend = props.message.body_replyless ?? '';
    if (fromBackend) return fromBackend;
    return htmlStructure()?.replylessHtml ?? '';
  });

  const isPlaintext = () => !props.message.body_html_sanitized;

  const parsedSource = createMemo(() => {
    const useFullHtml = showFullHTML() || props.isFirstMessageInThread;
    if (useFullHtml && props.message.body_html_sanitized) {
      return parseEmailContent(
        props.message.body_html_sanitized,
        !showFullHTML(),
        !showFullHTML()
      );
    }
    const replyless = bodyReplyless();
    if (replyless) {
      return parseEmailContent(replyless);
    }
    if (props.message.body_html_sanitized) {
      return parseEmailContent(
        props.message.body_html_sanitized,
        !showFullHTML(),
        !showFullHTML()
      );
    }
    return undefined;
  });

  const source = () => parsedSource();

  const bodyHtmlHasQuote = createMemo(() => {
    if (!props.message.body_html_sanitized || !props.message.body_macro) {
      return false;
    }
    return htmlStructure()?.hasQuote ?? false;
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

  const isPersonal = createMemo(() =>
    isPersonalMessage(props.message, userEmail(), props.personalSenders())
  );

  const isMacroSender = createMemo(() => {
    const senderEmail = props.message.from?.email?.toLowerCase();
    return senderEmail?.endsWith('@macro.com') ?? false;
  });

  onMount(() => {
    const host = hostContainer();
    if (!host || host.shadowRoot) return;

    const shadow = host.attachShadow({ mode: 'open' });
    const styleEl = document.createElement('style');
    styleEl.dataset.macroEmailBody = '';
    styleEl.textContent = `${EMAIL_BODY_CONTAINMENT_CSS}${personalFontOverrideCss(isPersonal(), isMacroSender())}`;
    shadow.appendChild(styleEl);

    const contentDiv = document.createElement('div');
    shadow.appendChild(contentDiv);
    setMessageDiv(contentDiv);
  });

  createEffect(() => {
    const contentDiv = messageDiv();
    if (!contentDiv) return;

    source();
    isPersonal();
    isMacroSender();

    populateMessageDiv(
      contentDiv,
      source()?.mainContent ?? '',
      isPersonal(),
      isMacroSender()
    );
  });

  createEffect(() => {
    source();
    const root = hostContainer()?.shadowRoot;
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
      resolveCidImages(root, attachments);
      if (disposed) return;
      await fetchImagesViaPlatform(root, blobUrls, () => disposed);
    });
  });

  createEffect(() => {
    themeUpdate();
    showFullHTML();
    const root = hostContainer()?.shadowRoot;
    if (root) {
      if (isPersonal() || !source()?.hasTable) {
        let disposed = false;
        onCleanup(() => {
          disposed = true;
        });
        scheduleAfterFirstPaint(() => {
          if (disposed) return;
          untrack(() => {
            const theme: ThemeColorParams = {
              inkL: themeReactive.c0.l[0](),
              inkC: themeReactive.c0.c[0](),
              inkH: themeReactive.c0.h[0](),
              panelL: themeReactive.b1.l[0](),
              accentL: themeReactive.a0.l[0](),
              accentC: themeReactive.a0.c[0](),
              accentH: themeReactive.a0.h[0](),
            };
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
          contentWrapper.style.setProperty('color', 'black');
        }
      }
    }
  });

  createEffect(() => {
    const container = hostContainer();
    if (!container) return;
    const shouldHide = !props.isBodyExpanded();
    container.style.setProperty(
      '--macro-email-img-display',
      shouldHide ? 'none' : 'initial'
    );
  });

  createEffect(() => {
    const container = hostContainer();
    if (!container) return;
    source();

    const clearScale = () => {
      const root = container.shadowRoot;
      if (!root) return;
      const contentDiv = root.querySelector('div');
      if (contentDiv instanceof HTMLElement) {
        contentDiv.style.zoom = '';
        contentDiv.style.overflow = '';
        contentDiv.style.overflowX = '';
      }
    };

    if (!props.isBodyExpanded()) {
      clearScale();
      return;
    }

    const applyScale = () => {
      const root = container.shadowRoot;
      if (!root) return;
      const contentDiv = root.querySelector('div');
      if (!contentDiv || !(contentDiv instanceof HTMLElement)) return;

      contentDiv.style.zoom = '';
      contentDiv.style.overflow = '';
      contentDiv.style.overflowX = '';

      const fit = fitToWidthZoom({
        containerWidth: container.clientWidth,
        contentWidth: contentDiv.scrollWidth,
      });
      if (!fit) {
        return;
      }
      contentDiv.style.zoom = `${fit.zoom}`;
      if (fit.overflowsAfterZoom) {
        contentDiv.style.overflowX = 'auto';
      }
    };

    const resizeObserver = new ResizeObserver(() => applyScale());
    resizeObserver.observe(container);

    const root = container.shadowRoot;
    const images = root ? Array.from(root.querySelectorAll('img')) : [];
    const onImageLoad = () => applyScale();
    for (const img of images) {
      if (!img.complete) {
        img.addEventListener('load', onImageLoad);
      }
    }

    requestAnimationFrame(() => applyScale());

    onCleanup(() => {
      resizeObserver.disconnect();
      for (const img of images) {
        img.removeEventListener('load', onImageLoad);
      }
    });
  });

  return (
    <div
      class="ph-no-capture flex flex-col pt-1"
      onPointerDown={() => {
        if (!props.isBodyExpanded() && props.message.db_id) {
          props.setExpandedMessageBody(props.message.db_id);
          props.setFocusedMessageId(props.message.db_id);
        } else if (props.message.db_id) {
          props.setFocusedMessageId(props.message.db_id);
        }
      }}
    >
      <div
        class="relative"
        classList={{
          isPersonal: isPersonal(),
          'line-clamp-3': !props.isBodyExpanded(),
        }}
      >
        <Switch>
          <Match when={!showFullHTML() && props.message.body_macro}>
            {(bodyMacro) => {
              return (
                <StaticMarkdown
                  markdown={bodyMacro()}
                  theme={channelTheme}
                  target="internal"
                />
              );
            }}
          </Match>
          <Match when={isPlaintext()}>
            <StaticMarkdown
              markdown={props.message.body_text!}
              theme={channelTheme}
              target="internal"
            />
          </Match>
          <Match when={true}>
            <div ref={setHostContainer} />
          </Match>
        </Switch>
        <Show when={!showFullHTML() && hasHiddenReplyStructure()}>
          <div class="flex items-center mt-1.5 mb-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowFullHTML(true)}
              class={cn(
                'rounded-md text-ink-extra-muted hover:text-ink-muted',
                props.isFocused ? 'hover:bg-surface' : 'hover:bg-active'
              )}
            >
              <DotsThree />
            </Button>
          </div>
        </Show>
      </div>
    </div>
  );
}
