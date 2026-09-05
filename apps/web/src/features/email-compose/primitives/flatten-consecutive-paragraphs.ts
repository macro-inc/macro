/**
 * Flattens runs of consecutive `<p>` siblings into a single `<div>` with
 * explicit `<br>` separators, matching how Gmail structures composed mail.
 * Email clients apply their own margins to `<p>`, so relying on them renders
 * differently per client. The editor shows a paragraph break as a blank line,
 * so non-empty paragraphs are joined by two `<br>`s; empty paragraphs already
 * export their own `<br>` and need no extra separator.
 */
export function flattenConsecutiveParagraphs(container: Element) {
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
        // Paragraph break = one blank line for the recipient
        div.appendChild(document.createElement('br'));
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
