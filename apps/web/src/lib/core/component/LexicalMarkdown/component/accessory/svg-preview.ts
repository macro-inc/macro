/** The Source SVG preview's existing content checks and sanitizing, shared with native presentation. */
export function prepareSvgPreview(
  content: string
): { kind: 'empty' } | { kind: 'invalid' } | { kind: 'svg'; html: string } {
  if (!content.trim()) return { kind: 'empty' };
  const trimmedContent = content.trim().toLowerCase();
  if (!trimmedContent.startsWith('<svg') && !trimmedContent.includes('<svg')) {
    return { kind: 'invalid' };
  }
  return {
    kind: 'svg',
    html: content
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
      .replace(/javascript:/gi, ''),
  };
}

/** Preserve the Source preview's post-mount SVG sizing. */
export function sizeSvgPreview(container: HTMLDivElement) {
  const svgElements = container.querySelectorAll('svg');
  svgElements.forEach((svg: SVGElement) => {
    svg.style.maxWidth = '100%';
    svg.style.maxHeight = '100%';
    svg.style.width = 'auto';
    svg.style.height = 'auto';
    svg.style.display = 'block';
    svg.style.margin = 'auto';
  });
}
