function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function plainTextToHtml(text: string): string {
  const lines = text.split('\n');
  const inner = lines
    .map((line) => {
      if (!line) return '<br>';
      return `<span style="white-space: pre-wrap;">${escapeHtml(line)}</span>`;
    })
    .join('<br>');
  return `<div>${inner}</div>`;
}
