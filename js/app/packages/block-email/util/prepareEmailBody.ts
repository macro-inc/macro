import { formatEmailDate } from '@core/util/date';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { $createQuoteNode } from '@lexical/rich-text';
import { $dfsIterator } from '@lexical/utils';
import {
  $createClassedBlockNode,
  $createDocumentMentionNode,
  $createHtmlRenderNode,
  $isClassedBlockNode,
  type ClassedBlockNode,
  type DocumentMentionInfo,
} from '@lexical-core';
import type { ApiMessage } from '@service-email/generated/schemas';
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

export const TOGGLE_APPEND_EMAIL_THREAD_COMMAND = createCommand<{
  replyingTo: ApiMessage | undefined;
  replyType?: ReplyType;
  visible: boolean;
}>('TOGGLE_APPEND_EMAIL_THREAD_COMMAND');

type HeaderDescriptor =
  | { kind: 'forward'; lines: string[] }
  | { kind: 'reply'; text: string };

function buildHeaderDescriptor(
  replyingTo: ApiMessage,
  replyType: ReplyType | undefined
): HeaderDescriptor {
  const replyingToDate = replyingTo.internal_date_ts ?? replyingTo.created_at;
  const formattedDate = formatEmailDate(replyingToDate);

  if (replyType === 'forward') {
    const lines: string[] = [];
    lines.push('---------- Forwarded message ----------');
    const fromName = replyingTo.from?.name ?? replyingTo.from?.email ?? '';
    const fromEmail = replyingTo.from?.email ?? '';
    lines.push(`From: ${fromName} <${fromEmail}>`);
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

  const headerText =
    'On ' +
    formattedDate +
    ' ' +
    (replyingTo.from?.name ?? replyingTo.from?.email) +
    ' <' +
    (replyingTo.from?.email ?? '') +
    '> wrote: ';
  return { kind: 'reply', text: headerText };
}

function $generateHeaderNodes(
  replyingTo: ApiMessage,
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
    attributes: replyingTo.replying_to_id
      ? {
          [REPLYING_TO_ID_ATTRIBUTE]: replyingTo.replying_to_id,
        }
      : undefined,
  });
  const emailHeaderText = $createTextNode(descriptor.text);
  emailHeader.append(emailHeaderText);
  return [emailHeader];
}

const REPLYING_TO_ID_ATTRIBUTE = 'data-replying-to-id';

const $appendPreviousEmail = (
  editor: LexicalEditor,
  replyingTo: ApiMessage | undefined,
  replyType: ReplyType | undefined
) => {
  if (!replyingTo) return true;
  const wrapper = $createClassedBlockNode({
    tag: 'div',
    classes: ['macro_quote', 'gmail_quote'],
    attributes: replyingTo.replying_to_id
      ? {
          [REPLYING_TO_ID_ATTRIBUTE]: replyingTo.replying_to_id,
        }
      : undefined,
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

function* $findPreviousEmailNode(replyingToID: string | undefined) {
  if (!replyingToID) yield;
  for (const { node } of $dfsIterator()) {
    if (!$isClassedBlockNode(node)) continue;

    const replyingToIDAttr = node.__attributes?.[REPLYING_TO_ID_ATTRIBUTE];
    if (!replyingToIDAttr || replyingToIDAttr !== replyingToID) {
      // In our case, quoted text replies do not exist more than once in the
      // same message so returning any classed block node with the proper class
      // should be valid. This is probably fine but we might not want to do this.
      // The backend seems to strip the html of data attributes during sanitization
      // so we can't check for the replying id attribute
      if (node.__classes.includes('macro_quote')) {
        yield node;
      }
      continue;
    }
    yield node;
  }
  yield;
}

function removeAppendedThread(
  editor: LexicalEditor,
  replyingToID: string | undefined
) {
  if (!replyingToID) return;

  editor.update(
    () => {
      for (const node of $findPreviousEmailNode(replyingToID)) {
        if (!node) continue;

        node.remove();
      }
    },
    { discrete: true }
  );
}

export function registerToggleAppendedThread(editor: LexicalEditor) {
  return editor.registerCommand(
    TOGGLE_APPEND_EMAIL_THREAD_COMMAND,
    ({ replyingTo, visible, replyType }) => {
      const replyingToID = replyingTo?.replying_to_id ?? undefined;

      if (!visible) {
        removeAppendedThread(editor, replyingToID);
        return true;
      }

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
  replyingTo: ApiMessage,
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
    // Extract style tags from head to preserve email styling for weirdo emails with initial style tags.
    const styleTags = innerDom.head?.querySelectorAll('style');
    styleTags?.forEach((style) => {
      quote.appendChild(style);
    });
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

function applyMediaScale(container: Element) {
  const mediaElements = container.querySelectorAll<HTMLElement>(
    'img[data-scale], video[data-scale]'
  );
  mediaElements.forEach((el) => {
    const scale = parseFloat(el.getAttribute('data-scale') || '1');
    if (scale === 1) return;
    const width = parseInt(el.getAttribute('width') || '0', 10);
    const height = parseInt(el.getAttribute('height') || '0', 10);
    if (width > 0)
      el.setAttribute('width', Math.round(width * scale).toString());
    if (height > 0)
      el.setAttribute('height', Math.round(height * scale).toString());
  });
}

function flattenConsecutiveParagraphs(container: Element) {
  const paragraphs = container.querySelectorAll('p');
  const groups = [];
  let currentGroup: Element[] = [];

  for (let i = 0; i < paragraphs.length; i++) {
    if (i === 0) {
      currentGroup.push(paragraphs[i]);
      continue;
    }

    // Check if this paragraph immediately follows the previous one
    const prev = paragraphs[i - 1];
    if (prev.nextElementSibling === paragraphs[i]) {
      currentGroup.push(paragraphs[i]);
    } else {
      // Start a new group
      groups.push(currentGroup);
      currentGroup = [paragraphs[i]];
    }
  }

  // Don't forget the last group
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  // Combine each group and replace in the DOM
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const div = document.createElement('div');

    for (let j = 0; j < group.length; j++) {
      const p = group[j];

      const isEmpty =
        !p.textContent?.trim() &&
        !p.querySelector('img, video, iframe, canvas');

      if (p.childNodes.length) {
        div.append(...p.childNodes);
      }

      if (j < group.length - 1 && !isEmpty) {
        div.appendChild(document.createElement('br'));
      }
    }

    // Replace the first paragraph with the combined div
    group[0]?.parentNode?.replaceChild(div, group[0]);

    // Remove the rest of the paragraphs in this group
    for (let j = 1; j < group.length; j++) {
      group[j].remove();
    }
  }
}

export function prepareEmailBody(
  editor: LexicalEditor | undefined,
  // if this argument is provided, we append the message being replied to the html email body
  appendReply?: {
    replyType: ReplyType | undefined;
    replyingTo: ApiMessage;
  }
): {
  bodyHtml: string;
  bodyText: string;
  mentions: DocumentMentionInfo[];
} | null {
  if (!editor) return null;
  const generatedHtml = editor.read(() => {
    return $generateHtmlFromNodes(editor);
  });

  const parsed = new DOMParser().parseFromString(generatedHtml, 'text/html');

  flattenConsecutiveParagraphs(parsed.body);

  // Apply image scale to width/height attributes so the recipient sees the resized dimensions
  applyMediaScale(parsed.body);

  // Convert Macro document mentions to HTML links in the parsed DOM
  const mentions = convertMentionsToLinks(parsed.body);

  if (appendReply && !parsed.body.querySelector('.macro_quote')) {
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
  const bodyHtml = html;
  const bodyText = parsed.body.firstChild?.textContent ?? '';

  return { bodyHtml, bodyText, mentions };
}

/**
 * Returns true if the draft has meaningful user content worth saving.
 * Auto-filled reply/forward subjects alone don't count.
 */
export function hasDraftContent(
  bodyText: string,
  subject: string | undefined,
  attachmentCount: number,
  recipientCount?: number
): boolean {
  const hasBody = bodyText.trim() !== '';
  const hasAttachments = attachmentCount > 0;
  const hasRecipients = (recipientCount ?? 0) > 0;
  const trimmedSubject = subject?.trim() ?? '';
  const hasSubject = trimmedSubject.length > 0;
  const subjectIsAutoFilled = /^(Re|Fwd?):/i.test(trimmedSubject);
  return (
    hasBody ||
    hasAttachments ||
    hasRecipients ||
    (hasSubject && !subjectIsAutoFilled)
  );
}

export function prepareMacroBody(bodyMacro: string): string {
  // Remove macro-quote blocks from the markdown string
  // We want these in the HTML, but not in body_macro
  // TODO (seamus + peter) Add logic for binding a markdown signal that skips certain transforms
  return bodyMacro.replace(/<macro-quote>.*?<\/macro-quote>/gs, '').trim();
}
