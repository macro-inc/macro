import { formatEmailDate } from '@core/util/date';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { $createQuoteNode } from '@lexical/rich-text';
import {
  $createClassedBlockNode,
  $createDocumentMentionNode,
  $createHtmlRenderNode,
  $isClassedBlockNode,
  type ClassedBlockNode,
  type DocumentMentionInfo,
} from '@lexical-core';
import type { MessageWithBodyReplyless } from '@service-email/generated/schemas';
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isLineBreakNode,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import type { ReplyType } from './replyType';

export function clearEmailBody(editor: LexicalEditor | undefined) {
  if (!editor) return;
  editor.update(
    () => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      root.clear();
      root.append(paragraph);
    },
    { tag: 'external' }
  );
}

export const APPEND_PREVIOUS_EMAIL_COMMAND = createCommand<{
  replyingTo: MessageWithBodyReplyless | undefined;
  replyType?: ReplyType;
}>('APPEND_PREVIOUS_EMAIL_COMMAND');

type HeaderDescriptor =
  | { kind: 'forward'; lines: string[] }
  | { kind: 'reply'; text: string };

function buildHeaderDescriptor(
  replyingTo: MessageWithBodyReplyless,
  replyType: ReplyType | undefined
): HeaderDescriptor {
  if (replyType === 'forward') {
    const lines: string[] = [];
    lines.push('---------- Forwarded message ----------');
    const fromName = replyingTo.from?.name ?? replyingTo.from?.email ?? '';
    const fromEmail = replyingTo.from?.email ?? '';
    lines.push(`From: ${fromName} <${fromEmail}>`);
    const epochSeconds =
      new Date(
        (replyingTo.internal_date_ts ?? replyingTo.created_at) as any
      ).getTime() / 1000;
    const formattedDate = formatEmailDate(epochSeconds);
    lines.push(`Date: ${formattedDate}`);
    lines.push(`Subject: ${replyingTo.subject ?? ''}`);

    const toRecipients = replyingTo.to ?? [];
    if (toRecipients.length > 0) {
      const toText = toRecipients
        .filter(Boolean)
        .map((r) => {
          const name = r?.name ?? r?.email ?? '';
          const email = r?.email ?? '';
          return `${name} <${email}>`;
        })
        .join(', ');
      lines.push(`To: ${toText}`);
    }

    const ccRecipients = replyingTo.cc ?? [];
    if (ccRecipients.length > 0) {
      const ccText = ccRecipients
        .filter(Boolean)
        .map((r) => {
          const name = r?.name ?? r?.email ?? '';
          const email = r?.email ?? '';
          return `${name} <${email}>`;
        })
        .join(', ');
      lines.push(`Cc: ${ccText}`);
    }

    return { kind: 'forward', lines };
  }

  const epochSeconds =
    new Date(
      (replyingTo.internal_date_ts ?? replyingTo.created_at) as any
    ).getTime() / 1000;
  const headerText =
    'On ' +
    formatEmailDate(epochSeconds) +
    ' ' +
    (replyingTo.from?.name ?? replyingTo.from?.email) +
    ' <' +
    (replyingTo.from?.email ?? '') +
    '> wrote: ';
  return { kind: 'reply', text: headerText };
}

function $generateHeaderNodes(
  replyingTo: MessageWithBodyReplyless,
  replyType: ReplyType | undefined
): LexicalNode[] {
  const descriptor = buildHeaderDescriptor(replyingTo, replyType);
  if (descriptor.kind === 'forward') {
    return descriptor.lines.map((line) => {
      const p = $createParagraphNode();
      p.append($createTextNode(line));
      return p;
    });
  }
  const emailHeader = $createClassedBlockNode({
    tag: 'div',
    classes: ['gmail_attr'],
  });
  const emailHeaderText = $createTextNode(descriptor.text);
  emailHeader.append(emailHeaderText);
  return [emailHeader];
}

const $appendPreviousEmail = (
  editor: LexicalEditor,
  replyingTo: MessageWithBodyReplyless | undefined,
  replyType: ReplyType | undefined
) => {
  if (!replyingTo) return true;
  const wrapper = $createClassedBlockNode({
    tag: 'div',
    classes: ['macro_quote', 'gmail_quote'],
  });
  const spacing = $createLineBreakNode();
  wrapper.append(spacing);
  const quoteNode = $createQuoteNode();
  const headerNodes = $generateHeaderNodes(replyingTo, replyType);
  headerNodes.forEach((n) => wrapper.append(n));

  const replyingToBodyHTML = replyingTo.body_html_sanitized;
  if (!replyingToBodyHTML) {
    // Plain text email
    const textNode = $createTextNode(replyingTo.body_text ?? '');
    quoteNode.append(textNode);
  } else {
    const parser = new DOMParser();
    const dom = parser.parseFromString(replyingToBodyHTML, 'text/html');
    // We are checking if the appended reply contains a table. This is not exact, but is a good indicator that an email will contain content that we can not render correctly, in which case the appended reply will be a non-editable HTML Render Node.
    const hasTable = Boolean(dom.querySelector('table'));
    if (hasTable) {
      const htmlNode = $createHtmlRenderNode({ html: replyingToBodyHTML });
      quoteNode.append(htmlNode);
    } else {
      const nodes = $generateNodesFromDOM(editor, dom);
      nodes.forEach((node) => {
        quoteNode.append(node);
      });
    }
  }
  wrapper.append(quoteNode);

  $getRoot().append(wrapper);
  return true;
};

export function registerAppendPreviousEmail(editor: LexicalEditor) {
  return editor.registerCommand(
    APPEND_PREVIOUS_EMAIL_COMMAND,
    ({ replyingTo, replyType }) => {
      $appendPreviousEmail(editor, replyingTo, replyType);
      return true;
    },
    COMMAND_PRIORITY_EDITOR
  );
}

export async function appendItemsAsMacroMentions(
  editor: LexicalEditor | undefined,
  items: DocumentMentionInfo[]
) {
  if (!editor) return;
  if (!items || items.length === 0) return;
  editor.update(() => {
    const root = $getRoot();

    // Find an existing mentions wrapper (search from the end for the most recent)
    const children = root.getChildren();
    let wrapper: ClassedBlockNode | null = null;
    for (let i = children.length - 1; i >= 0; i--) {
      const candidate = children[i];
      if (
        $isClassedBlockNode(candidate) &&
        (candidate as any).__classes?.includes('macro_mentions')
      ) {
        wrapper = candidate as any;
        break;
      }
    }

    // If no wrapper, create one and add an empty line above it
    if (!wrapper) {
      const spacer = $createParagraphNode();
      root.append(spacer);
      wrapper = $createClassedBlockNode({
        tag: 'div',
        classes: ['macro_mentions'],
      });
      root.append(wrapper);
    }

    // Append each mention as its own paragraph at the bottom of the wrapper
    items.forEach((item) => {
      const last = wrapper.getLastChild();
      if (last && !$isLineBreakNode(last)) {
        wrapper.append($createLineBreakNode());
      }

      const mention = $createDocumentMentionNode({
        documentId: item.documentId,
        documentName: item.documentName,
        blockName: item.blockName,
      });

      wrapper.append(mention);
      // Trailing break to keep future insertions on a new line
      wrapper.append($createLineBreakNode());
    });
  });
}

function getAppendedReplyElement(
  replyingTo: MessageWithBodyReplyless,
  replyType: ReplyType | undefined
) {
  const wrapper = document.createElement('div');
  wrapper.classList.add('macro_quote', 'gmail_quote');
  const spacing = document.createElement('p');
  spacing.textContent = '\n';
  wrapper.appendChild(spacing);

  const descriptor = buildHeaderDescriptor(replyingTo, replyType);
  if (descriptor.kind === 'forward') {
    descriptor.lines.forEach((line) => {
      const p = document.createElement('p');
      p.textContent = line;
      wrapper.appendChild(p);
    });
  } else {
    const emailHeaderDiv = document.createElement('div');
    emailHeaderDiv.classList.add('gmail_attr');
    emailHeaderDiv.textContent = descriptor.text;
    wrapper.appendChild(emailHeaderDiv);
  }

  const quote = document.createElement('blockquote');
  const replyingToBodyHTML = replyingTo.body_html_sanitized;
  if (!replyingToBodyHTML) {
    quote.textContent = replyingTo.body_text ?? '';
  } else {
    const innerDom = new DOMParser().parseFromString(
      replyingToBodyHTML,
      'text/html'
    );
    quote.appendChild(innerDom.body);
  }

  wrapper.appendChild(quote);
  return wrapper;
}

function convertMentionsToLinks(root: ParentNode) {
  const mentionElements = root.querySelectorAll<HTMLElement>(
    '[data-document-mention="true"]'
  );
  let mentions: DocumentMentionInfo[] = [];
  mentionElements.forEach((el) => {
    const mention: DocumentMentionInfo = {
      documentId: el.getAttribute('data-document-id') || '',
      documentName: el.getAttribute('data-document-name') || '',
      blockName: el.getAttribute('data-block-name') || '',
      blockParams: el.getAttribute('data-block-params')
        ? JSON.parse(el.getAttribute('data-block-params') || '{}')
        : undefined,
      mentionUuid: el.getAttribute('data-mention-uuid') || undefined,
      collapsed: el.getAttribute('data-collapsed')
        ? Boolean(el.getAttribute('data-collapsed'))
        : undefined,
      channelType: el.getAttribute('data-channel-type') || undefined,
    };
    if (!mention.documentId || !mention.documentName || !mention.blockName)
      return;
    const href =
      window.location.origin +
      '/app/' +
      mention.blockName +
      '/' +
      mention.documentId;
    const link = document.createElement('a');
    link.href = href;
    link.textContent = mention.documentName;
    // Preserve mention data attributes so importDOM() can recreate Lexical nodes
    link.setAttribute('data-document-mention', 'true');
    link.setAttribute('data-document-id', mention.documentId);
    link.setAttribute('data-document-name', mention.documentName);
    link.setAttribute('data-block-name', mention.blockName);
    if (mention.blockParams)
      link.setAttribute(
        'data-block-params',
        JSON.stringify(mention.blockParams)
      );
    if (mention.mentionUuid)
      link.setAttribute('data-mention-uuid', mention.mentionUuid);
    if (mention.collapsed)
      link.setAttribute('data-collapsed', mention.collapsed.toString());
    if (mention.channelType)
      link.setAttribute('data-channel-type', mention.channelType);
    el.replaceWith(link);
    mentions.push(mention);
  });
  return mentions;
}

export function prepareEmailBody(
  editor: LexicalEditor | undefined,
  // if this argument is provided, we append the message being replied to the html email body
  appendReply?: {
    replyType: ReplyType | undefined;
    replyingTo: MessageWithBodyReplyless;
  }
): {
  bodyHtml: string;
  bodyText: string;
  mentions: DocumentMentionInfo[];
} | null {
  if (!editor) return null;
  let generatedHtml = '';
  let bodyHtml = '';
  let bodyText = '';
  editor.read(() => {
    generatedHtml = $generateHtmlFromNodes(editor);
  });

  const parsed = new DOMParser().parseFromString(generatedHtml, 'text/html');

  // Convert Macro document mentions to HTML links in the parsed DOM
  const mentions = convertMentionsToLinks(parsed.body);

  if (appendReply) {
    const appendedReplyElement = getAppendedReplyElement(
      appendReply.replyingTo,
      appendReply.replyType
    );
    parsed.body.appendChild(appendedReplyElement);
  }

  const html = btoa(unescape(encodeURIComponent(parsed.body.outerHTML)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/={1,}$/, '');
  bodyHtml = html;
  bodyText = parsed.body.firstChild?.textContent ?? '';

  return { bodyHtml, bodyText, mentions };
}
