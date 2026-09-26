import {
  type PreparedEmailBody,
  prepareEmailBody,
} from '@macro-inc/email-renderer';
import {
  type EmailBodyRenderer,
  mountEmailBody,
} from '@macro-inc/email-renderer/browser';
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js';
import type {
  EmailPreparation,
  EmailPreparationRequest,
  PreparedEmailLease,
} from '../context/email-preparation';
import type { EmailRenderingContextValue } from '../context/email-rendering-context';
import type { EmailMessageBodyProps } from './email-message-body';

function sameRequest(
  a: EmailPreparationRequest,
  b: EmailPreparationRequest
): boolean {
  return (
    !!a &&
    !!b &&
    a.messageId === b.messageId &&
    a.mailboxId === b.mailboxId &&
    a.threadId === b.threadId &&
    a.input.html === b.input.html &&
    a.input.replylessHtml === b.input.replylessHtml &&
    a.input.text === b.input.text &&
    a.options.showFullContent === b.options.showFullContent &&
    a.options.showQuotedContent === b.options.showQuotedContent &&
    a.options.images?.remote === b.options.images?.remote &&
    a.options.images?.proxyUrl === b.options.images?.proxyUrl
  );
}

/** One renderer per message identity; asynchronous preparation stays body-local. */
export function createStableEmailMessageBody(
  props: EmailMessageBodyProps,
  context: EmailRenderingContextValue
) {
  const identity = createMemo(() =>
    JSON.stringify([props.message.link_id, props.message.db_id])
  );
  const [quoted, setQuoted] = createSignal<{
    identity: string;
    value: boolean;
  }>();
  const [attempt, setAttempt] = createSignal(0);
  const wantsFullHTML = () =>
    quoted()?.identity === identity() && quoted()?.value === true;
  const request = createMemo<EmailPreparationRequest, undefined>(
    () => ({
      messageId: props.message.db_id,
      threadId: props.message.thread_db_id,
      mailboxId: props.message.link_id,
      input: {
        html: props.message.body_html_sanitized ?? null,
        replylessHtml: props.message.body_replyless ?? null,
        text: props.message.body_text ?? null,
      },
      options: {
        showQuotedContent: wantsFullHTML(),
        showFullContent: props.showFullContent ?? false,
        images: {
          remote: context.images?.remote ?? 'allow',
          proxyUrl: context.images?.proxyUrl,
        },
      },
    }),
    undefined,
    { equals: sameRequest }
  );

  const state = createMemo(() => {
    identity();
    context.canRender?.();
    const [body, setBody] = createSignal<PreparedEmailBody>();
    const [host, setHost] = createSignal<HTMLElement>();
    const [pending, setPending] = createSignal(false);
    const [error, setError] = createSignal(false);
    const [fullHTML, setFullHTML] = createSignal(false);
    const current = {
      body,
      setBody,
      host,
      setHost,
      pending,
      setPending,
      error,
      setError,
      fullHTML,
      setFullHTML,
      renderer: undefined as EmailBodyRenderer | undefined,
      lease: undefined as PreparedEmailLease | undefined,
      rendered: undefined as PreparedEmailBody | undefined,
      presentation: '',
      disposed: false,
      imagePolicy: '',
      preparation: undefined as EmailPreparation | undefined,
    };
    onCleanup(() => {
      current.disposed = true;
      current.lease?.release();
      current.renderer?.dispose();
    });
    return current;
  });
  // Keep the existing Markdown/HTML route while a quote variant is pending.
  const showFullHTML = () => state().fullHTML();
  const setShowFullHTML = (value: boolean) =>
    batch(() => {
      if (wantsFullHTML() === value && state().error())
        setAttempt((attempt) => attempt + 1);
      setQuoted({ identity: identity(), value });
    });

  // Cache acquisition is an imperative external-system lifetime. The request
  // memo compares just primitives, so equal transport DTOs never acquire again.
  createEffect(() => {
    attempt();
    const current = state();
    if (context.canRender?.() === false) return;
    const selected = request();
    const preparation = context.preparation;
    const imagePolicy = JSON.stringify(selected.options.images);
    if (
      (current.imagePolicy && current.imagePolicy !== imagePolicy) ||
      current.preparation !== preparation
    ) {
      current.renderer?.dispose();
      current.renderer = undefined;
      current.rendered = undefined;
      current.setHost(undefined);
      current.setBody(undefined);
      current.setFullHTML(false);
      current.lease?.release();
      current.lease = undefined;
    }
    current.imagePolicy = imagePolicy;
    current.preparation = preparation;
    let active = true;
    let lease: PreparedEmailLease | undefined;
    current.setError(false);
    function accept(body: PreparedEmailBody) {
      if (!active || current.disposed) {
        lease?.release();
        return;
      }
      if (current.lease !== lease) current.lease?.release();
      current.lease = lease;
      batch(() => {
        current.setBody(body);
        current.setFullHTML(selected.options.showQuotedContent ?? false);
        current.setPending(false);
      });
    }
    async function receive() {
      try {
        accept(await lease!.promise);
      } catch (error) {
        if (!active || current.disposed) return;
        current.setPending(false);
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          current.setError(true);
        }
      }
    }
    try {
      if (preparation) {
        lease = preparation.acquire(selected);
        if (lease.ready) accept(lease.ready);
        else {
          current.setPending(true);
          void receive();
        }
      } else {
        accept(prepareEmailBody(selected.input, selected.options));
      }
    } catch {
      current.setError(true);
      current.setPending(false);
    }
    onCleanup(() => {
      active = false;
      // The displayed variant stays leased until a replacement is accepted.
      if (lease !== current.lease) lease?.release();
    });
  });

  const attachmentBindings = createMemo(() => {
    const bindings = new Map<string, string>();
    for (const attachment of props.message.attachments) {
      if (attachment.content_id && attachment.sfs_id)
        bindings.set(
          attachment.content_id.replace(/[<>]/g, ''),
          attachment.sfs_id
        );
    }
    return JSON.stringify([...bindings].sort(([a], [b]) => a.localeCompare(b)));
  });

  createEffect(() => {
    const current = state();
    const body = current.body();
    const htmlEnabled =
      context.canRender?.() !== false &&
      !(!showFullHTML() && props.message.body_macro) &&
      !!props.message.body_html_sanitized;
    if (!htmlEnabled) {
      current.renderer?.dispose();
      current.renderer = undefined;
      current.rendered = undefined;
      current.setHost(undefined);
      return;
    }
    if (!body) return;
    const theme = context.theme();
    const adaptColors = props.isPersonal || !body.hasTable;
    const normalizeFonts =
      props.isPersonal &&
      !props.message.from?.email?.toLowerCase().endsWith('@macro.com');
    const presentation = JSON.stringify([
      theme.inkL,
      theme.inkC,
      theme.inkH,
      theme.panelL,
      theme.accentL,
      theme.accentC,
      theme.accentH,
      adaptColors,
      normalizeFonts,
      attachmentBindings(),
    ]);
    if (current.rendered === body && current.presentation === presentation)
      return;
    const attachments = untrack(() => props.message.attachments);
    const options = {
      theme,
      adaptColors,
      normalizeFonts,
      expanded: untrack(props.isBodyExpanded),
      prepareLinks: context.prepareLinks,
      resolveImages: (
        root: ShadowRoot,
        lifetime: Parameters<typeof context.resolveImages>[2]
      ) => context.resolveImages(root, attachments, lifetime),
    };
    if (current.renderer) {
      current.renderer.update(body, options);
    } else {
      const host = document.createElement('div');
      // Keep wide designed email contained within the pane.
      host.style.minWidth = '0';
      host.style.width = '100%';
      current.renderer = mountEmailBody(host, body, options);
      current.setHost(host);
    }
    current.rendered = body;
    current.presentation = presentation;
  });
  createEffect(() => {
    const expanded = props.isBodyExpanded();
    const current = state();
    current.host();
    current.renderer?.setExpanded(expanded);
  });
  return {
    showFullHTML,
    setShowFullHTML,
    host: () => state().host(),
    hasHiddenReplyStructure: () => state().body()?.hasHiddenContent ?? false,
    isPending: () => state().pending(),
    isError: () => state().error(),
    retry: () => setAttempt((value) => value + 1),
  };
}
