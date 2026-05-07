// Email body parsing utilities
export {
  type ParsedEmailContent,
  parseEmailContent,
  trimTrailingBrs,
} from './parse-email-html';

// Image proxy utilities
export { proxyEmailImages } from './proxy-email-images';

// Color transformation utilities
export {
  processEmailColors,
  type ThemeColorParams,
} from './transform-email-colors';
