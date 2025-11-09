interface IProps {
  font?: string;
  defaultWidth?: number;
  padding?: number;
}

/**
 * Returns the single line width of text for a given font
 */
export function estimateTextWidth(text: string, props?: IProps): number {
  const { font, defaultWidth = 0, padding = 0 } = props ?? {};
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return defaultWidth;
  context.font = font ?? 'normal normal normal 16px sans-serif';
  return context.measureText(text).width + padding;
}
