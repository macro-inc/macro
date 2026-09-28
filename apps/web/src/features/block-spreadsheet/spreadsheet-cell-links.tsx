import { LinkWithPreview } from '@core/component/LexicalMarkdown/component/core/LinkWithPreview';
import { findNextAutoLinkMatch } from '@core/component/LexicalMarkdown/plugins/links/linksPlugin';
import { For } from 'solid-js';
export function SpreadsheetCellLinks(props: { value: string }) {
  const parts = () => {
    const result: { text: string; url?: string }[] = [];
    let remaining = props.value;
    while (remaining) {
      const web = findNextAutoLinkMatch(remaining);
      // Email domains can use newer TLDs absent from linkify's bundled list.
      const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.exec(remaining);
      const match =
        email && (!web || email.index < web.index)
          ? {
              index: email.index,
              lastIndex: email.index + email[0].length,
              raw: email[0],
              url: `mailto:${email[0]}`,
            }
          : web;
      if (!match) {
        result.push({ text: remaining });
        break;
      }
      if (match.index) result.push({ text: remaining.slice(0, match.index) });
      result.push({ text: match.raw, url: match.url });
      remaining = remaining.slice(match.lastIndex);
    }
    return result;
  };
  return (
    <For each={parts()}>
      {(part) =>
        part.url ? (
          <span
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onDblClick={(event) => event.stopPropagation()}
          >
            <LinkWithPreview
              url={part.url}
              title={part.text}
              class="underline decoration-current/30 underline-offset-2 hover:decoration-current"
            >
              {part.text}
            </LinkWithPreview>
          </span>
        ) : (
          part.text
        )
      }
    </For>
  );
}
