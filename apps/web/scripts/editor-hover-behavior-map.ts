// Real node/DOM lookup and store policy; no rendered attribution or service data.
export const EDITOR_HOVER_BEHAVIOR_MAP = [
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/blame-tooltip/blameTooltipPlugin.ts',
    anchor: 'function $resolveHoveredNodeId(',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/blame-hover.test.ts',
    cases: [
      'blame hover node policy resolves the nearest stable text id and records pointer coordinates',
      'blame hover node policy falls back to the stable paragraph id for text without its own id',
      'blame hover node policy dismisses when neither text nor its ancestors has a stable id',
      'blame hover node policy does not offer blame for a paragraph background instead of text',
    ],
  },
  {
    source:
      'apps/web/src/lib/core/component/LexicalMarkdown/plugins/blame-tooltip/blameTooltipPlugin.ts',
    anchor: 'function registerBlameTooltipPlugin(',
    testFile:
      'apps/web/src/lib/core/component/LexicalMarkdown/behavior-inventory/blame-hover.test.ts',
    cases: [
      'blame hover node policy dismisses a pointer event targeting SVG rather than an HTML element',
      'blame hover node policy suppresses a nonempty native selection=false',
      'blame hover node policy suppresses a nonempty native selection=true',
      'blame hover node policy ignores pointer movement on a primary touch device',
      'blame hover node policy dismisses an existing hover on pointerleave',
      'blame hover node policy dismisses an existing hover on pointerdown',
      'blame hover node policy dismisses an existing hover on beforeinput',
      'blame hover node policy dismisses on a nonbubbling scroll captured from a descendant',
      'blame hover node policy moves pointer listeners to a replacement root and detaches the previous root',
      'blame hover node policy unregisters root pointer and document scroll listeners on disposal',
    ],
  },
] as const;
