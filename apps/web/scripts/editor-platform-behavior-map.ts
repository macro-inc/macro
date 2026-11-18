// Geometry and platform constants are host facts. These mappings do not
// establish native keyboard delivery, glide deletion or scroll animation.
export const EDITOR_PLATFORM_BEHAVIOR_MAP = [
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/restore-focus/restoreFocusPlugin.ts',
    anchor: 'export function restoreFocusPlugin(',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/focus-guards.test.ts',
    cases: [
      'restore focus boundary guards uses the mouse immediate pointer guard before restoring a root caret',
      'restore focus boundary guards uses the mouse next timer pointer guard before restoring a root caret',
      'restore focus boundary guards uses the touch before 500ms pointer guard before restoring a root caret',
      'restore focus boundary guards uses the touch at 500ms pointer guard before restoring a root caret',
      'restore focus boundary guards uses the pen next timer pointer guard before restoring a root caret',
      'restore focus boundary guards keeps real DOM focus on an embedded toolbar control instead of refocusing the editor',
      'restore focus boundary guards does not restore or cancel focus events after disposal',
      'restore focus boundary guards detaches pointer guards from the old root while restoring focus on its replacement',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/ios-cursor-scroll/iosCursorScrollPlugin.ts',
    anchor: 'export function iosCursorScrollPlugin(',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/ios-caret-scroll.test.ts',
    cases: [
      'iOS caret scroll geometry uses the visual viewport bottom with fifty pixels of caret padding',
      'iOS caret scroll geometry uses the native keyboard inset bottom with fifty pixels of caret padding',
      'iOS caret scroll geometry uses the shorter scroll container bottom with fifty pixels of caret padding',
      'iOS caret scroll geometry does not scroll a caret at or above the safe boundary: 550',
      'iOS caret scroll geometry does not scroll a caret at or above the safe boundary: 500',
      'iOS caret scroll geometry falls back to window height when visual viewport is unavailable',
      'iOS caret scroll geometry does not scroll when both DOM and model caret selections are absent',
      'iOS caret scroll geometry does not schedule scrolling for committed edits while the keyboard is hidden',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/native-ios-backspace/nativeIosBackspacePlugin.ts',
    anchor: 'export function nativeIosBackspacePlugin()',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/native-ios-backspace/nativeIosBackspacePlugin.test.ts',
    cases: [
      'nativeIosBackspacePlugin leaves a Backspace inside text to the iOS keyboard',
      'nativeIosBackspacePlugin keeps Lexical handling at the start of a block',
    ],
  },
] as const;
