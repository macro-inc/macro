/**
 * Flattens runs of consecutive `<p>` siblings with matching attributes into a `<div>` with
 * explicit `<br>` separators, matching how Gmail structures composed mail.
 * Email clients apply their own margins to `<p>`, so relying on them renders
 * differently per client. The editor shows a paragraph break as a blank line,
 * so non-empty paragraphs are joined by two `<br>`s; empty paragraphs already
 * export their own `<br>` and need no extra separator.
 */
export function flattenConsecutiveParagraphs(container: Element) {
  let nextSibling: Element | null = null;
  let div: HTMLDivElement | undefined;

  for (const p of container.querySelectorAll('p')) {
    const attributes = Array.from(p.attributes);
    if (
      !div ||
      p !== nextSibling ||
      div.attributes.length !== attributes.length ||
      attributes.some(({ name, value }) => div?.getAttribute(name) !== value)
    ) {
      div = document.createElement('div');
      for (const { name, value } of attributes) div.setAttribute(name, value);
      p.before(div);
    }
    nextSibling = p.nextElementSibling;
    const isEmpty =
      !p.textContent?.trim() && !p.querySelector('img, video, iframe, canvas');
    div.append(...p.childNodes);
    if (nextSibling?.matches('p') && !isEmpty) {
      // Retain the blank line even when the next paragraph has a different style.
      div.append(document.createElement('br'), document.createElement('br'));
    }
    p.remove();
  }
}
