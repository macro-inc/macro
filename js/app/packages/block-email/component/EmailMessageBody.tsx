import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { SERVER_HOSTS } from '@core/constant/servers';
import {
  parseEmailContent,
  processEmailColors,
  type ThemeColorParams,
} from '@core/email';
import DotsThree from '@icon/light/dots-three-light.svg';
import type { ApiMessage } from '@service-email/generated/schemas';
import { useEmail } from '@core/context/user';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  Match,
  onCleanup,
  Show,
  Switch,
  untrack,
} from 'solid-js';
import { themeReactive } from '../../block-theme/signals/themeReactive';
import { themeUpdate } from '../../block-theme/signals/themeSignals';

interface EmailMessageBodyProps {
  message: ApiMessage;
  isBodyExpanded: Accessor<boolean>;
  setExpandedMessageBody: (id: string) => void;
  setFocusedMessageId: (messageID: string | undefined) => void;
  isFirstMessageInThread: boolean;
  isFocused: boolean;
}

export function EmailMessageBody(props: EmailMessageBodyProps) {
  const [showFullHTML, setShowFullHTML] = createSignal<boolean>(false);
  const userEmail = useEmail();

  if (DEV_MODE_ENV) {
    console.log(
      'labels',
      props.message.labels.map((l) => l.name)
    );
  }

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
    return showFullHTML() || props.isFirstMessageInThread
      ? parsedBodyHtml()
      : parsedBodyReplyless();
  };

  const hasHiddenReplyStructure = () => {
    return (
      !isPlaintext() &&
      ((bodyReplyless() &&
        bodyReplyless().toString().replace(/\s+/g, '').length !==
          props.message.body_html_sanitized?.toString().replace(/\s+/g, '')
            .length) ||
        source()?.signature)
    );
  };

  // TODO it might be nice to do some additional checks here, e.g. check if this message was sent from a user that the user has sent a message to before.
  const isPersonal = createMemo(() => {
    return (
      props.message.from?.email === userEmail() ||
      props.message.labels.some((l) => l.name === 'CATEGORY_PERSONAL')
    );
  });

  const host = createMemo(() => {
    themeUpdate();
    const hostContainer = document.createElement('div');
    const shadow = hostContainer.attachShadow({ mode: 'open' });
    // Style that uses a CSS variable to control image visibility
    const styleEl = document.createElement('style');
    // Normalize font in email
    const fontOverride = isPersonal()
      ? `*:not(code):not(pre):not(code *):not(pre *){font-family: system-ui, sans-serif !important; font-size: inherit !important; line-height: 1.5 !important;}`
      : '';
    styleEl.textContent = `img{display: var(--macro-email-img-display, initial); max-width: 100% !important; height: auto !important;}${fontOverride}`;
    shadow.appendChild(styleEl);
    const messageDiv = document.createElement('div');
    messageDiv.innerHTML = source()?.mainContent ?? '';
    // Open links in a new tab instead of navigating the current one
    for (const a of messageDiv.querySelectorAll('a[href]')) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
    messageDiv.style.userSelect = 'text';
    messageDiv.style.cursor = 'var(--cursor-auto)';
    shadow.appendChild(messageDiv);
    return hostContainer;
  });

  // Resolve inline images that reference attachments via cid: URLs
  createEffect(() => {
    const root = host().shadowRoot;
    if (root) {
      queueMicrotask(() => {
        // Build a map from normalized content-id => sfs_id
        const contentIdToSfsId = new Map<string, string>();
        for (const att of props.message.attachments ?? []) {
          const contentId = att.content_id;
          const sfsId = att.sfs_id;
          if (!contentId || !sfsId) continue;
          const normalized = contentId.replace(/[<>]/g, '');
          contentIdToSfsId.set(normalized, sfsId);
        }

        const images = root.querySelectorAll('img[src^="cid:"]');
        for (const img of images) {
          if (!(img instanceof HTMLImageElement)) continue;
          if (img.dataset.cidResolved === 'true') continue;
          const src = img.getAttribute('src');
          if (!src?.startsWith('cid:')) continue;
          const rawCid = src.slice(4);
          const normalizedCid = rawCid.replace(/[<>]/g, '');
          const sfsId = contentIdToSfsId.get(normalizedCid);
          if (!sfsId) continue;
          img.src = `${SERVER_HOSTS['static-file']}/file/${sfsId}`;
          img.dataset.cidResolved = 'true';
        }
      });
    }
  });

  // Process the email colors when: the theme changes, or the source HTML changes.
  createEffect(() => {
    themeUpdate();
    showFullHTML();
    const root = host().shadowRoot;
    if (root) {
      if (isPersonal() || !source()?.hasTable) {
        queueMicrotask(() => {
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

  // Scale down wide HTML emails to fit the container width (like Gmail on mobile)
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

      // Reset any previous scaling before measuring
      messageDiv.style.zoom = '';
      messageDiv.style.overflow = '';

      const containerWidth = container.clientWidth;
      const contentWidth = messageDiv.scrollWidth;

      if (containerWidth > 0 && contentWidth > containerWidth) {
        const scale = containerWidth / contentWidth;
        // Use zoom instead of transform: scale() so that backgrounds,
        // borders, and layout all shrink together without clipping.
        messageDiv.style.zoom = `${scale}`;
      } else {
        messageDiv.style.overflow = 'auto';
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
      class="flex flex-col pt-2"
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
          {/* If available, we use body_macro to render "Macro-fied" email content in static markdown with, e.g. correctly styled document mentions. */}
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
          <Match when={true}>{host()}</Match>
        </Switch>
        <Show when={!showFullHTML() && hasHiddenReplyStructure()}>
          <div class="flex items-center gap-2 mt-2">
            <DeprecatedIconButton
              theme="clear"
              icon={DotsThree}
              onclick={() => setShowFullHTML(true)}
              iconSize={15}
              size="xxs"
              class={`${props.isFocused ? 'hover:bg-panel' : 'hover:bg-active'}`}
            />
          </div>
        </Show>
      </div>
    </div>
  );
}
