import '@app/index.css';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { SerializedCustomCodeNode } from '@macro-inc/lexical-core';
import type { SerializedEditorState } from 'lexical';
import { render } from 'solid-js/web';
import { buildConfig } from '../../../builder/MarkdownConfigBuilder';
import { MarkdownShell } from '../../../builder/MarkdownShell';
import { initializeLexical } from '../../../init';
import { StaticMarkdown, StaticMarkdownContext } from '../StaticMarkdown';

declare global {
  interface Window {
    svgPreviewHandlers: string[];
  }
}

initializeLexical();

// An SVG written without a namespace, as people paste them, whose inline
// handlers (unquoted, on the root, an image, an animation, and HTML inside a
// foreignObject) each record their element. A preview must draw the blue
// rectangle without running any of them.
window.svgPreviewHandlers = [];
const SVG = [
  '<svg width="120" height="80" onload=svgPreviewHandlers.push(this.tagName)>',
  '  <rect width="120" height="80" fill="#4f7cff"/>',
  '  <image href="data:," onerror=svgPreviewHandlers.push(this.tagName) />',
  '  <animate attributeName="opacity" values="1;1" dur="1s" onbegin=svgPreviewHandlers.push(this.tagName) />',
  '  <foreignObject width="1" height="1"><img src="data:," onerror=svgPreviewHandlers.push(this.tagName)></foreignObject>',
  '</svg>',
].join('\n');

// An icon drawn in currentColor, as icon sets draw their strokes.
const ICON =
  '<svg width="24" height="24"><rect width="24" height="24" fill="currentColor"/></svg>';

// A document saved with the code block's preview on, so it opens previewed.
const STORED_CODE_BLOCK: SerializedCustomCodeNode = {
  type: 'custom-code',
  version: 1,
  language: 'svg',
  previewEnabled: true,
  text: SVG,
  children: [],
  direction: null,
  format: '',
  indent: 0,
};
const STORED_DOCUMENT: SerializedEditorState = {
  root: {
    type: 'root',
    version: 1,
    children: [STORED_CODE_BLOCK],
    direction: null,
    format: '',
    indent: 0,
  },
};

function Fixture() {
  document.documentElement.dataset.touchDevice = String(isTouchDevice());
  const editor = buildConfig('markdown').namespace('svg-preview').withCode();
  return (
    <StaticMarkdownContext>
      <main class="h-dvh overflow-y-auto p-6 bg-page text-ink max-w-2xl space-y-6">
        <h1 class="text-xl font-medium">SVG code previews</h1>
        <section data-testid="message" class="space-y-2">
          <h2>Message</h2>
          <StaticMarkdown markdown={`\`\`\`svg\n${SVG}\n\`\`\``} />
        </section>
        <section data-testid="icon" class="space-y-2">
          <h2>Icon</h2>
          <StaticMarkdown markdown={`\`\`\`svg\n${ICON}\n\`\`\``} />
        </section>
        <section data-testid="document" class="space-y-2">
          <h2>Document</h2>
          <MarkdownShell
            config={editor}
            initialState={STORED_DOCUMENT}
            ariaLabel="Document"
          />
        </section>
      </main>
    </StaticMarkdownContext>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
