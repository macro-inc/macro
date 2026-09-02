import { scrubActiveContent } from '@core/email';
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
} from '@macro-inc/lexical-core';
import type { ApiMessage } from '@service-email/generated/schemas';
import {
  $addUpdateTag,
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isLineBreakNode,
  $setSelection,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import { flattenConsecutiveParagraphs } from './flattenConsecutiveParagraphs';
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
  /** Whether the quoted message is personal (drives theme-adapted rendering
   * of the quoted html, matching the message view) */
  isPersonal?: boolean;
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
    // Match Gmail's forward markup: headers live in a gmail_attr div inside
    // the gmail_quote — quote-trimming (ours and Gmail's) keys off it
    const emailHeader = $createClassedBlockNode({
      tag: 'div',
      classes: ['gmail_attr'],
      attributes: replyingTo.replying_to_id
        ? {
            [REPLYING_TO_ID_ATTRIBUTE]: replyingTo.replying_to_id,
          }
        : undefined,
    });
    descriptor.lines.forEach((line, i) => {
      if (i > 0) emailHeader.append($createLineBreakNode());
      emailHeader.append($createTextNode(line));
    });
    return [emailHeader];
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
  replyType: ReplyType | undefined,
  isPersonal?: boolean
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
    // The quoted body ends up in the live document (adopted nodes, or a shadow
    // root inside the html-render node), so scrub it while it is still inert.
    scrubActiveContent(dom);
    // Forwards always embed the original as a non-editable HTML Render Node so
    // the recipient gets the exact original markup. For replies, a table is a
    // good indicator of content we can't convert into editable nodes correctly.
    const hasTable = Boolean(dom.querySelector('table'));
    if (replyType === 'forward' || hasTable) {
      const htmlNode = $createHtmlRenderNode({
        html: dom.documentElement.innerHTML,
        // Same branch the message view takes: personal or table-less emails
        // get theme-adapted colors, table-layout emails get a white panel
        adaptColors: Boolean(isPersonal) || !hasTable,
      });
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
      $addUpdateTag('skip-dom-selection');
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
    ({ replyingTo, visible, replyType, isPersonal }) => {
      // Programmatic content change: don't let selection reconciliation
      // move DOM focus into the editor
      $addUpdateTag('skip-dom-selection');
      const replyingToID = replyingTo?.replying_to_id ?? undefined;

      if (!visible) {
        removeAppendedThread(editor, replyingToID);
        return true;
      }

      $appendPreviousEmail(editor, replyingTo, replyType, isPersonal);
      // Appending leaves a dirty selection inside the quote; any later
      // update would flush it to the DOM and steal focus into the editor
      $setSelection(null);

      return true;
    },
    COMMAND_PRIORITY_EDITOR
  );
}

async function _appendItemsAsMacroMentions(
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
    // These nodes are adopted into the live document below, which starts image
    // loads — scrub before that, not after.
    scrubActiveContent(innerDom);
    // Extract style tags from head to preserve email styling for weirdo emails with initial style tags.
    const styleTags = innerDom.head?.querySelectorAll('style');
    styleTags?.forEach((style) => {
      quote.appendChild(style);
    });
    quote.append(...Array.from(innerDom.body.childNodes));
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

  return prepareEmailBodyFromHtml(generatedHtml, appendReply);
}

/**
 * Same pipeline as {@link prepareEmailBody}, but starting from
 * editor-generated HTML instead of a live editor — for callers holding a
 * snapshot of editor content (e.g. undo-send restoring a draft).
 */
export function prepareEmailBodyFromHtml(
  generatedHtml: string,
  appendReply?: {
    replyType: ReplyType | undefined;
    replyingTo: ApiMessage;
  }
): {
  bodyHtml: string;
  bodyText: string;
  mentions: DocumentMentionInfo[];
} {
  const parsed = new DOMParser().parseFromString(generatedHtml, 'text/html');

  flattenConsecutiveParagraphs(parsed.body);

  // Apply image scale to width/height attributes so the recipient sees the resized dimensions
  applyMediaScale(parsed.body);

  // Convert Macro document mentions to HTML links in the parsed DOM
  const mentions = convertMentionsToLinks(parsed.body);

  // HtmlRenderNode exports as declarative shadow DOM; email clients and the
  // backend sanitizer drop template content, so inline it
  for (const host of parsed.body.querySelectorAll('div[data-html-render]')) {
    const template = host.querySelector('template[shadowrootmode]');
    if (template instanceof HTMLTemplateElement) {
      host.replaceChildren(template.content.cloneNode(true));
    }
  }

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
 * Auto-filled reply/forward subjects alone don't count. Pass recipientCount
 * only when recipients are user-entered (compose) and should keep the draft
 * alive — reply recipients are auto-derived, so the reply path omits it.
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
  // Remove appended-quote blocks from the markdown string
  // We want these in the HTML, but not in body_macro
  // TODO (seamus + peter) Add logic for binding a markdown signal that skips certain transforms
  return bodyMacro
    .replace(/<m-email-thread-embed>.*?<\/m-email-thread-embed>/gs, '')
    .trim();
}
