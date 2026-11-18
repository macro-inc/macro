// Actual plugin/editor/extraction; clipboard/FS and host IO boundaries supplied.
export const EDITOR_CLIPBOARD_BEHAVIOR_MAP = [
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/file-paste/filePastePlugin.ts',
    anchor: 'function registerFilePastePlugin(',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/file-paste-policy.test.ts',
    cases: [
      'actual file paste policy prefers directories over phantom duplicate files and skips mobile recovery and desktop staging',
      'actual file paste policy waits for mobile recovery before any desktop staging and prefers recovered entries',
      'actual file paste policy falls back to the original extracted file when mobile recovery resolves empty',
      'actual file paste policy consumes an empty mobile recovery without issuing a file callback or desktop fallback',
      'actual file paste policy yields for non-clipboard without preventing default or issuing IO',
      'actual file paste policy yields for absent-data without preventing default or issuing IO',
      'actual file paste policy yields for empty-data without preventing default or issuing IO',
      'actual file paste policy prevents default while desktop staging waits and forwards the staged entries once',
      'actual file paste policy forwards direct extracted browser files without preventing default',
      'actual file paste policy unregisters the actual paste handler on disposal',
    ],
  },
] as const;
