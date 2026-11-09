// Concrete behavior-to-test mappings reviewed against the linked source.
// A mapped case covers its named assertions, not every branch in its source file.
// Execution status belongs to the supplied run evidence, never this registry.
import { EDITOR_EXISTING_BEHAVIOR_MAP } from './editor-existing-behavior-map';
export const EDITOR_BEHAVIOR_MAP = [
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/component/menu/useMenuKeyboardNavigation.ts',
    anchor: 'function createMenuKeyboardNavigation',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/menu-keyboard.test.tsx',
    cases: [
      'inline menu keyboard navigation can delegate without preventing the browser default',
      'inline menu keyboard navigation does not dispatch while the menu is inactive or after disposal',
      'inline menu keyboard navigation leaves an unmodified h to ordinary typing',
      'inline menu keyboard navigation leaves an unmodified j to ordinary typing',
      'inline menu keyboard navigation leaves an unmodified k to ordinary typing',
      'inline menu keyboard navigation leaves an unmodified l to ordinary typing',
      'inline menu keyboard navigation leaves an unmodified n to ordinary typing',
      'inline menu keyboard navigation leaves an unmodified p to ordinary typing',
      'inline menu keyboard navigation leaves an unmodified x to ordinary typing',
      'inline menu keyboard navigation routes ArrowDown to down and consumes the event (undefined, undefined, undefined)',
      'inline menu keyboard navigation routes ArrowLeft to left and consumes the event (undefined, undefined, undefined)',
      'inline menu keyboard navigation routes ArrowRight to right and consumes the event (undefined, undefined, undefined)',
      'inline menu keyboard navigation routes ArrowUp to up and consumes the event (undefined, undefined, undefined)',
      'inline menu keyboard navigation routes Enter to select and consumes the event (undefined, undefined, undefined)',
      'inline menu keyboard navigation routes Escape to close and consumes the event (undefined, undefined, undefined)',
      'inline menu keyboard navigation routes Tab to down and consumes the event (undefined, undefined, undefined)',
      'inline menu keyboard navigation routes Tab to up and consumes the event (undefined, undefined, true)',
      'inline menu keyboard navigation routes h to left and consumes the event (true, undefined, undefined)',
      'inline menu keyboard navigation routes h to left and consumes the event (undefined, true, undefined)',
      'inline menu keyboard navigation routes j to down and consumes the event (true, undefined, undefined)',
      'inline menu keyboard navigation routes j to down and consumes the event (undefined, true, undefined)',
      'inline menu keyboard navigation routes k to up and consumes the event (true, undefined, undefined)',
      'inline menu keyboard navigation routes k to up and consumes the event (undefined, true, undefined)',
      'inline menu keyboard navigation routes l to right and consumes the event (true, undefined, undefined)',
      'inline menu keyboard navigation routes l to right and consumes the event (undefined, true, undefined)',
      'inline menu keyboard navigation routes n to down and consumes the event (true, undefined, undefined)',
      'inline menu keyboard navigation routes p to up and consumes the event (true, undefined, undefined)',
      'inline menu keyboard navigation space handler controls consumption: false',
      'inline menu keyboard navigation space handler controls consumption: true',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/await/awaitPlugin.ts',
    anchor: 'export function awaitPlugin',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/insertion.test.ts',
    cases: [
      'asynchronous placeholder replacement ignores a late replacement after its placeholder was deleted',
      'asynchronous placeholder replacement inserts a placeholder with inline=false',
      'asynchronous placeholder replacement inserts a placeholder with inline=true',
      'asynchronous placeholder replacement replaces the matching placeholder with empty nodes',
      'asynchronous placeholder replacement replaces the matching placeholder with missing nodes',
      'asynchronous placeholder replacement replaces the matching placeholder with multiple nodes',
      'asynchronous placeholder replacement replaces the matching placeholder with one nodes',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/checklist/checklistPlugin.ts',
    anchor: 'function registerChecklistPlugin',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/checklist.test.ts',
    cases: [
      'platform checklist shortcuts Linux: Shift+modifier+Enter stays with the host',
      'platform checklist shortcuts Linux: modifier+Enter aligns mixed checks opposite to the first (false)',
      'platform checklist shortcuts Linux: modifier+Enter aligns mixed checks opposite to the first (true)',
      'platform checklist shortcuts Mac: Shift+modifier+Enter stays with the host',
      'platform checklist shortcuts Mac: modifier+Enter aligns mixed checks opposite to the first (false)',
      'platform checklist shortcuts Mac: modifier+Enter aligns mixed checks opposite to the first (true)',
      'platform checklist shortcuts Windows: Shift+modifier+Enter stays with the host',
      'platform checklist shortcuts Windows: modifier+Enter aligns mixed checks opposite to the first (false)',
      'platform checklist shortcuts Windows: modifier+Enter aligns mixed checks opposite to the first (true)',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/checklist/checklistPlugin.ts',
    anchor: 'function registerMouseEvents',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/checklist.test.ts',
    cases: [
      'checklist pointer hit testing checks editability=false, drag=0, x=95',
      'checklist pointer hit testing checks editability=true, drag=0, x=160',
      'checklist pointer hit testing checks editability=true, drag=0, x=95',
      'checklist pointer hit testing checks editability=true, drag=12, x=95',
      'checklist pointer hit testing checks editability=true, drag=4, x=95',
      'checklist pointer hit testing checks editability=true, drag=5, x=95',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/custom-delete/customDeletePlugin.ts',
    anchor: 'export function customDeletePlugin',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/insertion.test.ts',
    cases: [
      'list deletion at boundaries DELETE_CHARACTER_COMMAND: converts bullet at offset zero to a paragraph',
      'list deletion at boundaries DELETE_CHARACTER_COMMAND: converts check at offset zero to a paragraph',
      'list deletion at boundaries DELETE_CHARACTER_COMMAND: converts number at offset zero to a paragraph',
      'list deletion at boundaries DELETE_CHARACTER_COMMAND: yields for range 0',
      'list deletion at boundaries DELETE_CHARACTER_COMMAND: yields for range 1',
      'list deletion at boundaries DELETE_LINE_COMMAND: converts bullet at offset zero to a paragraph',
      'list deletion at boundaries DELETE_LINE_COMMAND: converts check at offset zero to a paragraph',
      'list deletion at boundaries DELETE_LINE_COMMAND: converts number at offset zero to a paragraph',
      'list deletion at boundaries DELETE_LINE_COMMAND: yields for range 0',
      'list deletion at boundaries DELETE_LINE_COMMAND: yields for range 1',
      'list deletion at boundaries DELETE_WORD_COMMAND: converts bullet at offset zero to a paragraph',
      'list deletion at boundaries DELETE_WORD_COMMAND: converts check at offset zero to a paragraph',
      'list deletion at boundaries DELETE_WORD_COMMAND: converts number at offset zero to a paragraph',
      'list deletion at boundaries DELETE_WORD_COMMAND: yields for range 0',
      'list deletion at boundaries DELETE_WORD_COMMAND: yields for range 1',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/document-metadata/documentMetadataPlugin.ts',
    anchor: 'export function documentMetadataPlugin',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/metadata-and-accessories.test.ts',
    cases: [
      'persisted root metadata reports a document version newer than this client supports',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/document-metadata/documentMetadataPlugin.ts',
    anchor: 'export function $applyDocumentMetadataFromSerialized',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/metadata-and-accessories.test.ts',
    cases: [
      'persisted root metadata restores document metadata from serialized root state',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/emojis/emojisPlugin.ts',
    anchor: 'function registerEmojisPlugin',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/menus-and-stats.test.ts',
    cases: [
      'emoji search lifecycle Enter is consumed only while the menu is open: false',
      'emoji search lifecycle Enter is consumed only while the menu is open: true',
      'emoji search lifecycle checks the caret boundary in  at 0',
      'emoji search lifecycle checks the caret boundary in ` at 1',
      'emoji search lifecycle checks the caret boundary in word  at 5',
      'emoji search lifecycle checks the caret boundary in word at 0',
      'emoji search lifecycle checks the caret boundary in word at 4',
      'emoji search lifecycle collapse closes the active search',
      'emoji search lifecycle does not open inside a code block',
      'emoji search lifecycle remove closes the active search',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/horizontal-rules/horizontalRulePlugin.ts',
    anchor: 'export function horizontalRulePlugin',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/commands.test.ts',
    cases: [
      'horizontal rule insertion keeps a caret paragraph when inserting into the only empty block',
      'horizontal rule insertion splits a bullet list rather than nesting the rule inside it',
      'horizontal rule insertion splits a check list rather than nesting the rule inside it',
      'horizontal rule insertion splits a number list rather than nesting the rule inside it',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/insert-text/insertTextPlugin.ts',
    anchor: 'export function insertTextPlugin',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/insertion.test.ts',
    cases: [
      'insert text command inserts "" at a root selection',
      'insert text command inserts "emoji 😀" at a root selection',
      'insert text command inserts "line one\\nline two" at a root selection',
      'insert text command inserts "plain text" at a root selection',
      'insert text command replaces selected text and leaves the caret after the insertion',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/katex/katexPlugin.ts',
    anchor: 'TRY_INSERT_EQUATION_COMMAND,',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/commands.test.ts',
    cases: [
      'selection-gated insertion menus equation picker requires a selection: false',
      'selection-gated insertion menus equation picker requires a selection: true',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/katex/katexPlugin.ts',
    anchor: 'function registerKatexPlugin',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/commands.test.ts',
    cases: [
      'equation commands inserts and edits an equation with inline=false',
      'equation commands inserts and edits an equation with inline=true',
      'equation commands rejects empty-equation update targets without changing content',
      'equation commands rejects empty-key update targets without changing content',
      'equation commands rejects missing update targets without changing content',
      'equation commands rejects wrong-node update targets without changing content',
      'equation commands requests the existing equation editor through the host callback',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/keyboard-focus/keyboardFocusPlugin.ts',
    anchor: 'function registerKeyboardFocusPlugin',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/commands.test.ts',
    cases: [
      'host focus boundary navigation KEY_ARROW_DOWN_COMMAND is captured while a typeahead owns the keys with shift=false',
      'host focus boundary navigation KEY_ARROW_DOWN_COMMAND leaves the end boundary with shift=false',
      'host focus boundary navigation KEY_ARROW_DOWN_COMMAND yields inside code with shift=false',
      'host focus boundary navigation KEY_ARROW_LEFT_COMMAND is captured while a typeahead owns the keys with shift=false',
      'host focus boundary navigation KEY_ARROW_LEFT_COMMAND leaves the start boundary with shift=false',
      'host focus boundary navigation KEY_ARROW_LEFT_COMMAND yields inside code with shift=false',
      'host focus boundary navigation KEY_ARROW_RIGHT_COMMAND is captured while a typeahead owns the keys with shift=false',
      'host focus boundary navigation KEY_ARROW_RIGHT_COMMAND leaves the end boundary with shift=false',
      'host focus boundary navigation KEY_ARROW_RIGHT_COMMAND yields inside code with shift=false',
      'host focus boundary navigation KEY_ARROW_UP_COMMAND is captured while a typeahead owns the keys with shift=false',
      'host focus boundary navigation KEY_ARROW_UP_COMMAND leaves the start boundary with shift=false',
      'host focus boundary navigation KEY_ARROW_UP_COMMAND yields inside code with shift=false',
      'host focus boundary navigation KEY_TAB_COMMAND is captured while a typeahead owns the keys with shift=false',
      'host focus boundary navigation KEY_TAB_COMMAND is captured while a typeahead owns the keys with shift=true',
      'host focus boundary navigation KEY_TAB_COMMAND leaves the end boundary with shift=false',
      'host focus boundary navigation KEY_TAB_COMMAND leaves the start boundary with shift=true',
      'host focus boundary navigation KEY_TAB_COMMAND yields inside code with shift=false',
      'host focus boundary navigation KEY_TAB_COMMAND yields inside code with shift=true',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/location/locationPlugin.ts',
    anchor: 'export function serializePersistentLocation',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/location.test.ts',
    cases: [
      'persistent location encoding decodes and serializes anchor.0.5',
      'persistent location encoding decodes and serializes anchor.2,focus.8',
      'persistent location encoding decodes and serializes anchor.5.0',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/location/locationPlugin.ts',
    anchor: 'export function parsePersistentLocation',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/location.test.ts',
    cases: [
      'persistent location encoding rejects incomplete location ""',
      'persistent location encoding rejects incomplete location ".0.5"',
      'persistent location encoding rejects incomplete location "anchor"',
      'persistent location encoding rejects incomplete location "anchor..5"',
      'persistent location encoding rejects incomplete location "anchor.0"',
      'persistent location encoding rejects incomplete location "anchor.0,.1"',
      'persistent location encoding rejects incomplete location "anchor.0,focus.x"',
      'persistent location encoding rejects incomplete location "anchor.x.5"',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/location/locationPlugin.ts',
    anchor: 'function registerLocationPlugin',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/location.test.ts',
    cases: [
      'stable node location navigation finds a live stable ID with stale cached key=false',
      'stable node location navigation finds a live stable ID with stale cached key=true',
      'stable node location navigation publishes a range location then revokes it after its configured timeout',
      'stable node location navigation rejects an unknown stable ID without scrolling',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/markdown-paste/markdownPastePlugin.ts',
    anchor: 'function registerMarkdownPastePlugin',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/clipboard.test.ts',
    cases: [
      'quote clipboard insertion keeps pasted paragraphs quoted for backward=false',
      'quote clipboard insertion keeps pasted paragraphs quoted for backward=true',
      'markdown clipboard precedence Shift bypasses Markdown interpretation and keyup restores it',
      'markdown clipboard precedence parses plain clipboard Markdown # Heading',
      'markdown clipboard precedence parses plain clipboard Markdown **bold**',
      'markdown clipboard precedence parses plain clipboard Markdown - item',
      'markdown clipboard precedence parses plain clipboard Markdown > Quote',
      'markdown clipboard precedence parses plain clipboard Markdown `code`',
      'markdown clipboard precedence yields for empty-text',
      'markdown clipboard precedence yields for no-data',
      'markdown clipboard precedence yields for no-selection',
      'markdown clipboard precedence yields to a richer application/x-lexical-editor clipboard',
      'markdown clipboard precedence yields to a richer text/html clipboard',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/node-accessory/nodeAccessoryPlugin.ts',
    anchor: 'function registerNodeAccessoryPlugin',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/metadata-and-accessories.test.ts',
    cases: [
      'node accessory lifecycle force refresh preserves the accessory data and yields command propagation',
      'node accessory lifecycle tracks mounted paragraph DOM, updates and destroyed node keys',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/pinned-properties/pinnedPropertiesPlugin.ts',
    anchor: 'function registerPinnedPropertiesPlugin',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/metadata-and-accessories.test.ts',
    cases: [
      'persisted root metadata deduplicates additions, preserves pin order and ignores unknown removals',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/pinned-properties/pinnedPropertiesPlugin.ts',
    anchor: 'export function $getStoredPinnedProperties',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/metadata-and-accessories.test.ts',
    cases: [
      'persisted root metadata distinguishes untouched pins from a deliberately saved empty list',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/single-line/singleLinePlugin.ts',
    anchor: 'export function singleLinePlugin',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/insertion.test.ts',
    cases: [
      'single-line title normalization removes pasted line breaks without losing inline text',
      'single-line title normalization retains only the first root block',
      'single-line title normalization unwraps nested snippet paragraphs while preserving inline formatting',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tab-indentation/tabIndentationPlugin.ts',
    anchor: 'export function tabIndentationPlugin',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/indentation.test.ts',
    cases: [
      'bounded paragraph indentation Tab with shift=false delegates to the matching indent command',
      'bounded paragraph indentation Tab with shift=true delegates to the matching indent command',
      'bounded paragraph indentation allows only one level beyond a previous sibling at indent 0',
      'bounded paragraph indentation allows only one level beyond a previous sibling at indent 1',
      'bounded paragraph indentation allows only one level beyond a previous sibling at indent 2',
      'bounded paragraph indentation allows only one level beyond a previous sibling at indent 3',
      'bounded paragraph indentation does not indent a code block',
      'bounded paragraph indentation does not indent a heading block',
      'bounded paragraph indentation does not indent a quote block',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tables/tablePickerPlugin.ts',
    anchor: 'function registerTablePickerPlugin',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/commands.test.ts',
    cases: [
      'selection-gated insertion menus table picker requires a selection: false',
      'selection-gated insertion menus table picker requires a selection: true',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/tags/tagsPlugin.ts',
    anchor: 'function registerTagsPlugin',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/menus-and-stats.test.ts',
    cases: [
      'tag mention insertion lifecycle host-only titles create tags through callbacks without inserting inline nodes',
      'tag mention insertion lifecycle inline tags publish creation, deduplicated membership and removal',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/wordcount/wordcountPlugin.ts',
    anchor: 'function registerWordcountPlugin',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/menus-and-stats.test.ts',
    cases: [
      'word and character statistics counts    with the production segmenter',
      'word and character statistics counts café 😀 with the production segmenter',
      'word and character statistics counts hello, world! with the production segmenter',
      'word and character statistics counts one two with the production segmenter',
      'word and character statistics counts selected text and clears selected statistics after collapsing the caret',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/shared/registerInlineMenuTrigger.ts',
    anchor: 'export function registerInlineMenuTrigger',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/input-triggers.test.ts',
    cases: [
      'desktop and Android inline menu input #: detaches listeners from a retired root',
      'desktop and Android inline menu input #: handles Android Unidentified keydown through beforeinput',
      'desktop and Android inline menu input #: leaves non-trigger/composition input insertCompositionText alone (data=#, composing=undefined)',
      'desktop and Android inline menu input #: leaves non-trigger/composition input insertFromPaste alone (data=#, composing=undefined)',
      'desktop and Android inline menu input #: leaves non-trigger/composition input insertText alone (data=#, composing=true)',
      'desktop and Android inline menu input #: leaves non-trigger/composition input insertText alone (data=ordinary, composing=undefined)',
      'desktop and Android inline menu input #: triggers once for desktop keydown plus beforeinput',
      'desktop and Android inline menu input /: detaches listeners from a retired root',
      'desktop and Android inline menu input /: handles Android Unidentified keydown through beforeinput',
      'desktop and Android inline menu input /: leaves non-trigger/composition input insertCompositionText alone (data=/, composing=undefined)',
      'desktop and Android inline menu input /: leaves non-trigger/composition input insertFromPaste alone (data=/, composing=undefined)',
      'desktop and Android inline menu input /: leaves non-trigger/composition input insertText alone (data=/, composing=true)',
      'desktop and Android inline menu input /: leaves non-trigger/composition input insertText alone (data=ordinary, composing=undefined)',
      'desktop and Android inline menu input /: triggers once for desktop keydown plus beforeinput',
      'desktop and Android inline menu input :: detaches listeners from a retired root',
      'desktop and Android inline menu input :: handles Android Unidentified keydown through beforeinput',
      'desktop and Android inline menu input :: leaves non-trigger/composition input insertCompositionText alone (data=:, composing=undefined)',
      'desktop and Android inline menu input :: leaves non-trigger/composition input insertFromPaste alone (data=:, composing=undefined)',
      'desktop and Android inline menu input :: leaves non-trigger/composition input insertText alone (data=:, composing=true)',
      'desktop and Android inline menu input :: leaves non-trigger/composition input insertText alone (data=ordinary, composing=undefined)',
      'desktop and Android inline menu input :: triggers once for desktop keydown plus beforeinput',
      'desktop and Android inline menu input ;: detaches listeners from a retired root',
      'desktop and Android inline menu input ;: handles Android Unidentified keydown through beforeinput',
      'desktop and Android inline menu input ;: leaves non-trigger/composition input insertCompositionText alone (data=;, composing=undefined)',
      'desktop and Android inline menu input ;: leaves non-trigger/composition input insertFromPaste alone (data=;, composing=undefined)',
      'desktop and Android inline menu input ;: leaves non-trigger/composition input insertText alone (data=;, composing=true)',
      'desktop and Android inline menu input ;: leaves non-trigger/composition input insertText alone (data=ordinary, composing=undefined)',
      'desktop and Android inline menu input ;: triggers once for desktop keydown plus beforeinput',
      'desktop and Android inline menu input @: detaches listeners from a retired root',
      'desktop and Android inline menu input @: handles Android Unidentified keydown through beforeinput',
      'desktop and Android inline menu input @: leaves non-trigger/composition input insertCompositionText alone (data=@, composing=undefined)',
      'desktop and Android inline menu input @: leaves non-trigger/composition input insertFromPaste alone (data=@, composing=undefined)',
      'desktop and Android inline menu input @: leaves non-trigger/composition input insertText alone (data=@, composing=true)',
      'desktop and Android inline menu input @: leaves non-trigger/composition input insertText alone (data=ordinary, composing=undefined)',
      'desktop and Android inline menu input @: triggers once for desktop keydown plus beforeinput',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/normalize-enter/normalizeEnterPlugin.ts',
    anchor: 'function $handleEnterAtBlockStart',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/enter-boundaries.test.ts',
    cases: [
      'heading Enter boundaries empty h1 exits to a paragraph',
      'heading Enter boundaries empty h2 exits to a paragraph',
      'heading Enter boundaries empty h3 exits to a paragraph',
      'quote and paragraph Enter boundaries Enter at quote start handles "" content',
      'quote and paragraph Enter boundaries Enter at quote start handles "quote" content',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/normalize-enter/normalizeEnterPlugin.ts',
    anchor: 'function $handleEnterFromHeading',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/enter-boundaries.test.ts',
    cases: [
      'heading Enter boundaries Enter replaces selected heading text at 1,3',
      'heading Enter boundaries Enter replaces selected heading text at 3,1',
      'heading Enter boundaries h1 Enter at offset 0 preserves the split content and block types',
      'heading Enter boundaries h1 Enter at offset 2 preserves the split content and block types',
      'heading Enter boundaries h1 Enter at offset 4 preserves the split content and block types',
      'heading Enter boundaries h2 Enter at offset 0 preserves the split content and block types',
      'heading Enter boundaries h2 Enter at offset 2 preserves the split content and block types',
      'heading Enter boundaries h2 Enter at offset 4 preserves the split content and block types',
      'heading Enter boundaries h3 Enter at offset 0 preserves the split content and block types',
      'heading Enter boundaries h3 Enter at offset 2 preserves the split content and block types',
      'heading Enter boundaries h3 Enter at offset 4 preserves the split content and block types',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/normalize-enter/normalizeEnterPlugin.ts',
    anchor: 'function registerNormalizeEnterPlugin',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/enter-boundaries.test.ts',
    cases: [
      'modified Enter propagation normalization yields ctrlKey in a nonempty heading',
      'modified Enter propagation normalization yields metaKey in a nonempty heading',
      'modified Enter propagation normalization yields altKey in a nonempty heading',
      'modified Enter propagation normalization yields shiftKey in a nonempty heading',
      'quote and paragraph Enter boundaries ShiftEnter in an empty paragraph creates a paragraph rather than a line break',
      'quote and paragraph Enter boundaries ShiftEnter in nonempty text retains ordinary line-break behavior',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/normalize-enter/normalizeEnterPlugin.ts',
    anchor: 'function scheduleInlineStyleCleanup',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/enter-boundaries.test.ts',
    cases: [
      'quote and paragraph Enter boundaries retains inherited format and style with the production node registry',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/keyboard-shortcuts/keyboardShortcutsPlugin.ts',
    anchor: 'export const DefaultShortcuts',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/keyboard-formats.test.ts',
    cases: [
      'Mac editor formatting shortcuts KeyX changes selected text only with the platform modifier (correct=true)',
      'Mac editor formatting shortcuts KeyE changes selected text only with the platform modifier (correct=true)',
      'Mac editor formatting shortcuts KeyH changes selected text only with the platform modifier (correct=true)',
      'Mac editor formatting shortcuts KeyX changes selected text only with the platform modifier (correct=false)',
      'Mac editor formatting shortcuts KeyE changes selected text only with the platform modifier (correct=false)',
      'Mac editor formatting shortcuts KeyH changes selected text only with the platform modifier (correct=false)',
      'Windows editor formatting shortcuts KeyX changes selected text only with the platform modifier (correct=true)',
      'Windows editor formatting shortcuts KeyE changes selected text only with the platform modifier (correct=true)',
      'Windows editor formatting shortcuts KeyH changes selected text only with the platform modifier (correct=true)',
      'Windows editor formatting shortcuts KeyX changes selected text only with the platform modifier (correct=false)',
      'Windows editor formatting shortcuts KeyE changes selected text only with the platform modifier (correct=false)',
      'Windows editor formatting shortcuts KeyH changes selected text only with the platform modifier (correct=false)',
      'Linux editor formatting shortcuts KeyX changes selected text only with the platform modifier (correct=true)',
      'Linux editor formatting shortcuts KeyE changes selected text only with the platform modifier (correct=true)',
      'Linux editor formatting shortcuts KeyH changes selected text only with the platform modifier (correct=true)',
      'Linux editor formatting shortcuts KeyX changes selected text only with the platform modifier (correct=false)',
      'Linux editor formatting shortcuts KeyE changes selected text only with the platform modifier (correct=false)',
      'Linux editor formatting shortcuts KeyH changes selected text only with the platform modifier (correct=false)',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/keyboard-shortcuts/keyboardShortcutsPlugin.ts',
    anchor: 'export const ListAndQuoteShortcuts',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/keyboard-formats.test.ts',
    cases: [
      'Mac editor formatting shortcuts Digit7 transforms the actual block only with Shift (shift=true)',
      'Mac editor formatting shortcuts Digit8 transforms the actual block only with Shift (shift=true)',
      'Mac editor formatting shortcuts Digit9 transforms the actual block only with Shift (shift=true)',
      'Mac editor formatting shortcuts Digit7 transforms the actual block only with Shift (shift=false)',
      'Mac editor formatting shortcuts Digit8 transforms the actual block only with Shift (shift=false)',
      'Mac editor formatting shortcuts Digit9 transforms the actual block only with Shift (shift=false)',
      'Windows editor formatting shortcuts Digit7 transforms the actual block only with Shift (shift=true)',
      'Windows editor formatting shortcuts Digit8 transforms the actual block only with Shift (shift=true)',
      'Windows editor formatting shortcuts Digit9 transforms the actual block only with Shift (shift=true)',
      'Windows editor formatting shortcuts Digit7 transforms the actual block only with Shift (shift=false)',
      'Windows editor formatting shortcuts Digit8 transforms the actual block only with Shift (shift=false)',
      'Windows editor formatting shortcuts Digit9 transforms the actual block only with Shift (shift=false)',
      'Linux editor formatting shortcuts Digit7 transforms the actual block only with Shift (shift=true)',
      'Linux editor formatting shortcuts Digit8 transforms the actual block only with Shift (shift=true)',
      'Linux editor formatting shortcuts Digit9 transforms the actual block only with Shift (shift=true)',
      'Linux editor formatting shortcuts Digit7 transforms the actual block only with Shift (shift=false)',
      'Linux editor formatting shortcuts Digit8 transforms the actual block only with Shift (shift=false)',
      'Linux editor formatting shortcuts Digit9 transforms the actual block only with Shift (shift=false)',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/block-decorator-navigation/blockDecoratorNavigationPlugin.ts',
    anchor: 'function $stopOnBlock',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/decorator-navigation.test.ts',
    cases: [
      'image block navigation up at a root caret selects the decorator only without Shift (shift=true)',
      'image block navigation up at a root caret selects the decorator only without Shift (shift=false)',
      'image block navigation up moves a single node selection onto an adjacent decorator',
      'image block navigation down at a root caret selects the decorator only without Shift (shift=true)',
      'image block navigation down at a root caret selects the decorator only without Shift (shift=false)',
      'image block navigation down moves a single node selection onto an adjacent decorator',
      'video block navigation up at a root caret selects the decorator only without Shift (shift=true)',
      'video block navigation up at a root caret selects the decorator only without Shift (shift=false)',
      'video block navigation up moves a single node selection onto an adjacent decorator',
      'video block navigation down at a root caret selects the decorator only without Shift (shift=true)',
      'video block navigation down at a root caret selects the decorator only without Shift (shift=false)',
      'video block navigation down moves a single node selection onto an adjacent decorator',
      'horizontalrule block navigation up at a root caret selects the decorator only without Shift (shift=true)',
      'horizontalrule block navigation up at a root caret selects the decorator only without Shift (shift=false)',
      'horizontalrule block navigation up moves a single node selection onto an adjacent decorator',
      'horizontalrule block navigation down at a root caret selects the decorator only without Shift (shift=true)',
      'horizontalrule block navigation down at a root caret selects the decorator only without Shift (shift=false)',
      'horizontalrule block navigation down moves a single node selection onto an adjacent decorator',
      'database-query block navigation up at a root caret selects the decorator only without Shift (shift=true)',
      'database-query block navigation up at a root caret selects the decorator only without Shift (shift=false)',
      'database-query block navigation up moves a single node selection onto an adjacent decorator',
      'database-query block navigation down at a root caret selects the decorator only without Shift (shift=true)',
      'database-query block navigation down at a root caret selects the decorator only without Shift (shift=false)',
      'database-query block navigation down moves a single node selection onto an adjacent decorator',
      'document-card block navigation up at a root caret selects the decorator only without Shift (shift=true)',
      'document-card block navigation up at a root caret selects the decorator only without Shift (shift=false)',
      'document-card block navigation up moves a single node selection onto an adjacent decorator',
      'document-card block navigation down at a root caret selects the decorator only without Shift (shift=true)',
      'document-card block navigation down at a root caret selects the decorator only without Shift (shift=false)',
      'document-card block navigation down moves a single node selection onto an adjacent decorator',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/block-decorator-navigation/blockDecoratorNavigationPlugin.ts',
    anchor: 'export function $selectDocumentStart',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/decorator-navigation.test.ts',
    cases: [
      'image block navigation document entry selects a leading decorator without changing content',
      'video block navigation document entry selects a leading decorator without changing content',
      'horizontalrule block navigation document entry selects a leading decorator without changing content',
      'database-query block navigation document entry selects a leading decorator without changing content',
      'document-card block navigation document entry selects a leading decorator without changing content',
    ],
  },
  ...EDITOR_EXISTING_BEHAVIOR_MAP,
] as const;
