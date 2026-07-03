import type {
  AssistantMessagePart,
  ChatStream,
} from '@service-cognition/generated/schemas';
import type { StreamPlugin } from './types';

export const MENTION_OPEN = '<m-document-mention>';
export const MENTION_CLOSE = '</m-document-mention>';
/*
  A well-formed mention (tags + JSON payload) is a few hundred characters.
  A held mention that grows past this will never close — stop holding it.
*/
export const MAX_MENTION_LENGTH = 1024;

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
 * Holds back text that looks like an in-progress `<m-document-mention>` tag so
 * the viewer never sees the raw tag dripping in character by character; a
 * completed mention is released as one atomic text part so it renders as a
 * mention chip immediately. Text held for a tag that turns out not to be a
 * mention is released unchanged, and an open tag that grows past
 * MAX_MENTION_LENGTH is given up on — combined with the buffered stream's
 * flush-on-quiet and flush-on-done, an unclosed mention is never held forever.
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

  /*
   Release everything held that can no longer become (part of) a mention.
   Only holds from a '<' that is still a viable mention prefix onward.
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
      const viableMention =
        text.startsWith(MENTION_OPEN) || MENTION_OPEN.startsWith(text);
      if (viableMention && !isCodeContext()) {
        if (text.startsWith(MENTION_OPEN)) {
          const close = text.indexOf(MENTION_CLOSE);
          /* a complete mention -> release it as one atomic part */
          if (close !== -1) {
            out.push(...releaseMerged(close + MENTION_CLOSE.length));
            continue;
          }
          /* an open mention this large will never close -> give up on it */
          if (text.length > MAX_MENTION_LENGTH) {
            out.push(...release(text.length));
            break;
          }
        }
        /* mention (or a prefix that may become one) still streaming -> hold */
        break;
      }
      /* not a mention here (wrong tag, or inside code where the tag renders
         literally) -> release up to the next '<' */
      const next = text.indexOf('<', 1);
      out.push(...release(next === -1 ? text.length : next));
    }
    return out;
  }

  return {
    transform(part) {
      if (!isTextResponse(part)) {
        /* a non-text part interrupts any mention; release held text first to preserve order */
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
