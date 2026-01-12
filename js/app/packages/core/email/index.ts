// Email body parsing utilities
export {
  parseEmailContent,
  trimTrailingBrs,
  type ParsedEmailContent,
} from './parse-email-html';

// Color transformation utilities
export {
  processEmailColors,
  rgbaToOklch,
  normalizeRGBA,
  parseRGBA,
  findClosestContrastingColor,
  computeTextNodeColor,
  type ThemeColorParams,
  type TextNodeContrast,
} from './transform-email-colors';

// Email body rendering
export {
  renderEmailBody,
  setEmailImageVisibility,
  type EmailRenderOptions,
  type EmailRenderResult,
} from './render-email-body';
