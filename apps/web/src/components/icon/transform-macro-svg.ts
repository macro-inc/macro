const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const PERCENT_BOX = /\s+(width|height)=["']100%["']/g;

export function transformMacroSvg(svg: string): string {
  return svg.replace(HTML_COMMENT, '').replace(PERCENT_BOX, '');
}
