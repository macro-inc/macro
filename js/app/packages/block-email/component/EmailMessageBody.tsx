import { javascript } from '@codemirror/lang-javascript';
import { IconButton } from '@core/component/IconButton';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { isErr } from '@core/util/maybeResult';
import DotsThree from '@icon/regular/dots-three.svg';
import { emailClient } from '@service-email/client';
import type { MessageWithBodyReplyless } from '@service-email/generated/schemas';
import { useEmail } from '@service-gql/client';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  Match,
  type Setter,
  Show,
  Switch,
  untrack,
} from 'solid-js';
// import { selectedTheme } from '@core/signal/theme';
import { themeUpdate } from '../../block-theme/signals/themeSignals';
import { parseEmailContent } from '../util/parseEmailHTML';
import { processEmailColors } from '../util/transformEmailColors';

interface EmailMessageBodyProps {
  message: MessageWithBodyReplyless;
  isBodyExpanded: Accessor<boolean>;
  setExpandedMessageBody: (id: string) => void;
  setFocusedMessageId: Setter<string | undefined>;
}

export function EmailMessageBody(props: EmailMessageBodyProps) {
  const [showFullHTML, setShowFullHTML] = createSignal<boolean>(false);
  const userEmail = useEmail();
  javascript;

  if (DEV_MODE_ENV) {
    console.log(
      'labels',
      props.message.labels.map((l) => l.name)
    );
  }

  // If we don't have body replyless, it may be because it hasn't been generated yet. For instance, this is the case immediately after a message is sent. We can use the HTML to parse the message correctly.
  let bodyReplyless = props.message.body_replyless;
  if (!props.message.body_replyless) {
    if (props.message.body_html_sanitized) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(
        props.message.body_html_sanitized.toString(),
        'text/html'
      );
      const quoted = doc.body.querySelector('.macro_quote');
      if (quoted) {
        quoted?.remove();
        bodyReplyless = doc.body.innerHTML;
      }
    }
  }

  const isPlaintext = !props.message.body_html_sanitized;

  const parsedHTML = createMemo(() => {
    const source = showFullHTML()
      ? props.message.body_html_sanitized
      : (bodyReplyless ?? props.message.body_html_sanitized);
    if (!source) return { mainContent: '', signature: null, hasTable: false };
    return parseEmailContent(source, !showFullHTML(), !showFullHTML());
  });

  const hasHiddenReplyStructure = createMemo(() => {
    return (
      !isPlaintext &&
      ((bodyReplyless &&
        bodyReplyless?.toString().replace(/\s+/g, '').length !==
          props.message.body_html_sanitized?.toString().replace(/\s+/g, '')
            .length) ||
        parsedHTML().signature)
    );
  });

  // TODO it would be nice to do some additional checks here, e.g. check if this message was sent from a user that the user has sent a message to before.
  const isPersonal = createMemo(() => {
    return (
      (props.message.from?.email === userEmail() ||
        props.message.labels.some((l) => l.name === 'CATEGORY_PERSONAL')) &&
      !parsedHTML().hasTable
    );
  });

  const host = createMemo(() => {
    themeUpdate();
    const hostContainer = document.createElement('div');
    const shadow = hostContainer.attachShadow({ mode: 'open' });
    // Style that uses a CSS variable to control image visibility
    const styleEl = document.createElement('style');
    styleEl.textContent = `img{display: var(--macro-email-img-display, initial);}`;
    shadow.appendChild(styleEl);
    const messageDiv = document.createElement('div');
    messageDiv.innerHTML = parsedHTML().mainContent;
    messageDiv.style.userSelect = 'text';
    messageDiv.style.cursor = 'var(--cursor-auto)';
    messageDiv.style.overflow = 'auto';
    shadow.appendChild(messageDiv);
    return hostContainer;
  });

  // Get the attachment URLs for inline images that reference attachments via cid: URLs
  createEffect(() => {
    const root = host().shadowRoot;
    if (root) {
      // Resolve inline images that reference attachments via cid: URLs
      queueMicrotask(async () => {
        // Build a map from normalized content-id => attachment db_id
        const contentIdToDbId = new Map<string, string>();
        for (const att of props.message.attachments ?? []) {
          const contentId = att.content_id;
          const dbId = att.db_id;
          if (!contentId || !dbId) continue;
          const normalized = contentId.replace(/[<>]/g, '');
          contentIdToDbId.set(normalized, dbId);
        }

        const images = root.querySelectorAll('img[src^="cid:"]');
        await Promise.all(
          Array.from(images).map(async (img) => {
            if (!(img instanceof HTMLImageElement)) return;
            if (img.dataset.cidResolved === 'true') return;
            const src = img.getAttribute('src');
            if (!src?.startsWith('cid:')) return;
            const rawCid = src.slice(4);
            const normalizedCid = rawCid.replace(/[<>]/g, '');
            const dbId = contentIdToDbId.get(normalizedCid);
            if (!dbId) return;
            const res = await emailClient.getAttachmentUrl({ id: dbId });
            if (isErr(res)) return;
            const dataUrl = res[1].attachment.data_url;
            if (!dataUrl) return;
            img.src = dataUrl;
            img.dataset.cidResolved = 'true';
          })
        );
      });
    }
  });

  // Process the email colors when theme changes
  createEffect(() => {
    themeUpdate();
    const root = host().shadowRoot;
    if (root) {
      if (isPersonal()) {
        queueMicrotask(() => {
          untrack(() => processEmailColors(root));
        });
      } else if (parsedHTML().hasTable) {
        const contentWrapper = root.querySelector('div');
        console.log('contentWrapper', contentWrapper);
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
        class="text-sm relative"
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
          <Match when={isPlaintext}>
            <StaticMarkdown
              markdown={props.message.body_text!}
              theme={channelTheme}
              target="internal"
            />
          </Match>
          <Match when={true}>{host()}</Match>
        </Switch>
        <Show when={!showFullHTML() && hasHiddenReplyStructure()}>
          <div class="flex items-center gap-2">
            <IconButton
              theme="clear"
              icon={DotsThree}
              onclick={() => setShowFullHTML(true)}
              iconSize={12}
            />
          </div>
        </Show>
      </div>
    </div>
  );
}
