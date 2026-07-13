import type {
  AssistantMessagePart,
  ChatStream,
} from '@service-cognition/generated/schemas';
import type { StreamPlugin } from './types';

export const MENTION_OPEN = '<m-document-mention>';
export const MENTION_CLOSE = '</m-document-mention>';
export const MACRO_XML_PREFIX = '<m-';
const MACRO_XML_OPEN_TAG = /^<(m-[a-zA-Z0-9_-]+)>/;
/*
  Most inline Macro XML tags are compact. If a held tag grows past this,
  stop holding so malformed tags and large block payloads do not stay hidden.
*/
export const MAX_MACRO_XML_LENGTH = 4096;
export const MAX_MENTION_LENGTH = MAX_MACRO_XML_LENGTH;

type ChatResponse = Extract<ChatStream, { type: 'chat_message_response' }>;
type TextContent = Extract<AssistantMessagePart, { type: 'text' }>;
type TextResponse = ChatResponse & { content: TextContent };

function isTextResponse(part: ChatStream): part is TextResponse {
  return part.type === 'chat_message_response' && part.content.type === 'text';
}

function toTextPart(template: TextResponse, text: string): TextResponse {
  return { ...template, content: { ...template.content, text } };
}

/*
 Reports whether streamed text is currently landing in a code context.
 Must be cheap: it is re-read while a candidate tag is held (which also
 lets a late answer — e.g. a renderer that hasn't caught up yet — correct
 an earlier hold).
*/
export type IsCodeContext = () => boolean;

/**
 * Holds back text that looks like an in-progress Macro XML tag (`<m-...>`) so
 * the viewer never sees raw internal markup dripping in character by character;
 * a completed tag is released as one atomic text part so it renders as its
 * parsed node immediately. Text held for a tag that turns out not to be Macro
 * XML is released unchanged, and an open tag that grows past
 * MAX_MACRO_XML_LENGTH is given up on — combined with the buffered stream's
 * flush-on-quiet and flush-on-done, an unclosed tag is never held forever.
 *
 * A tag streaming into a code context (fenced block or inline code) renders
 * literally, so it is never held; `isCodeContext` reports what the message
 * renderer's already-parsed node tree says about where text is landing.
 */
export function createMentionBufferPlugin(
  isCodeContext: IsCodeContext = () => false
): StreamPlugin {
  /*
   Text consumed from the stream but not yet released, split by source part so
   released text keeps its original message metadata.
  */
  const segments: { template: TextResponse; text: string }[] = [];

  const pending = () => segments.map((s) => s.text).join('');

  /* Release the first `count` held characters as text parts, one per source segment. */
  function release(count: number): ChatStream[] {
    const out: ChatStream[] = [];
    while (count > 0 && segments.length > 0) {
      const segment = segments[0];
      if (segment.text.length <= count) {
        out.push(toTextPart(segment.template, segment.text));
        count -= segment.text.length;
        segments.shift();
      } else {
        out.push(toTextPart(segment.template, segment.text.slice(0, count)));
        segment.text = segment.text.slice(count);
        count = 0;
      }
    }
    return out;
  }

  /* Release the first `count` held characters merged into a single text part. */
  function releaseMerged(count: number): ChatStream[] {
    const template = segments[0]?.template;
    if (!template) return [];
    const text = release(count)
      .map((part) => (isTextResponse(part) ? part.content.text : ''))
      .join('');
    return [toTextPart(template, text)];
  }

  function canBecomeMacroXml(text: string): boolean {
    if (MACRO_XML_PREFIX.startsWith(text)) return true;
    return /^<m-[a-zA-Z0-9_-]*$/.test(text);
  }

  /*
   Release everything held that can no longer become (part of) Macro XML.
   Only holds from a '<' that is still a viable Macro XML prefix onward.
  */
  function drain(): ChatStream[] {
    const out: ChatStream[] = [];
    for (;;) {
      const text = pending();
      if (text.length === 0) break;
      const tagStart = text.indexOf('<');
      /* no possible mention start -> release everything */
      if (tagStart === -1) {
        out.push(...release(text.length));
        break;
      }
      /* release the text before the possible mention start */
      if (tagStart > 0) {
        out.push(...release(tagStart));
        continue;
      }
      const openTag = text.match(MACRO_XML_OPEN_TAG);
      const viableMacroXml = !!openTag || canBecomeMacroXml(text);
      if (viableMacroXml && !isCodeContext()) {
        if (text.length > MAX_MACRO_XML_LENGTH) {
          out.push(...release(text.length));
          break;
        }
        if (openTag) {
          const closeTag = `</${openTag[1]}>`;
          const close = text.indexOf(closeTag, openTag[0].length);
          /* a complete Macro XML tag -> release it as one atomic part */
          if (close !== -1) {
            out.push(...releaseMerged(close + closeTag.length));
            continue;
          }
        }
        /* Macro XML (or a prefix that may become it) still streaming -> hold */
        break;
      }
      /* not Macro XML here (wrong tag, or inside code where the tag renders
         literally) -> release up to the next '<' */
      const next = text.indexOf('<', 1);
      out.push(...release(next === -1 ? text.length : next));
    }
    return out;
  }

  return {
    transform(part) {
      if (!isTextResponse(part)) {
        /* a non-text part interrupts any held XML; release held text first to preserve order */
        return [...release(pending().length), part];
      }
      if (part.content.text.length === 0) return [];
      segments.push({ template: part, text: part.content.text });
      return drain();
    },
    flush() {
      return release(pending().length);
    },
    isHolding() {
      return segments.length > 0;
    },
  };
}
