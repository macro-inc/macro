// Compatibility entry point for the editor's HTML decorator and quoted replies.
// The implementation lives in the framework-independent renderer package.
export {
  applySenderColorScheme,
  hasLayoutTable,
  processEmailColors,
  type ThemeColorParams,
} from '@macro-inc/email-renderer/browser';
