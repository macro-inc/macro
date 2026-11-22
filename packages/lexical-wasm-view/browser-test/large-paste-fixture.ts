import { $convertToMarkdownString } from '@lexical/markdown';
import { registerRichText } from '@lexical/rich-text';
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import {
  EXTERNAL_TRANSFORMERS,
  NodeReplacements,
  nodeIdPlugin,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core';
import { createEditor } from 'lexical';
import { trailingParagraphPlugin } from '../../../apps/web/src/lib/core/component/LexicalMarkdown/plugins/trailing-paragraph/trailingParagraphPlugin';
import init, {
  EditorSession,
} from '../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { mountLocalSessionView } from '../src/local-session-view';
import { createBuiltinRegistry } from '../src/view/node-views/builtins';
import { registerMacroElementViews } from '../src/view/node-views/macro';

const errors: string[] = [];
const upstreamRoot = document.getElementById('upstream');
const nativeRoot = document.getElementById('native');
if (!upstreamRoot || !nativeRoot) throw new Error('Missing editor roots');
upstreamRoot.contentEditable = 'true';
const upstream = createEditor({
  namespace: 'large-paste',
  nodes: [...SupportedNodeTypes, ...NodeReplacements],
  onError: (error) => errors.push(String(error)),
});
upstream.setRootElement(upstreamRoot);
registerRichText(upstream);
trailingParagraphPlugin()(upstream);
nodeIdPlugin({
  nodes: SupportedNodeTypes,
  mappings: { idToNodeKeyMap: new Map(), nodeKeyToIdMap: new Map() },
})(upstream);
await init();
const native = await mountLocalSessionView(
  nativeRoot,
  registerMacroElementViews(createBuiltinRegistry()),
  {
    namespace: 'block-md-main',
    theme: {},
    editable: true,
    preset: 'rich',
    onError: (error) => errors.push(String(error)),
  },
  {
    viewEngine: /Firefox/.test(navigator.userAgent)
      ? 3
      : /AppleWebKit/.test(navigator.userAgent) &&
          !/Chrome/.test(navigator.userAgent)
        ? 2
        : 1,
    viewOs: 0,
    create: (config, now, wall) =>
      EditorSession.createMacro(ABI_MAJOR, config, now, wall),
  }
);
native.port.setState(
  JSON.stringify({
    root: {
      type: 'root',
      version: 1,
      direction: null,
      format: '',
      indent: 0,
      children: [
        {
          type: 'paragraph',
          version: 1,
          direction: null,
          format: '',
          indent: 0,
          textFormat: 0,
          textStyle: '',
          children: [],
        },
      ],
    },
  })
);
upstream.setEditorState(
  upstream.parseEditorState(
    native.port.query({ kind: 7, key: 0, flags: 0, text: '' }).text
  )
);

function normalizedDOM(node: Node): unknown {
  if (node.nodeType === Node.TEXT_NODE) return { text: node.nodeValue };
  if (!(node instanceof Element)) return { node: node.nodeName };
  return {
    tag: node.tagName.toLowerCase(),
    attributes: Array.from(node.attributes)
      .map((attribute) => [attribute.name, attribute.value])
      .sort(([a], [b]) => a.localeCompare(b)),
    children: Array.from(node.childNodes).map(normalizedDOM),
  };
}

const largePaste = {
  errors,
  async paste(
    engine: 'upstream' | 'native',
    html: string,
    text: string,
    delivery: 'trusted' | 'synthetic'
  ) {
    const root = engine === 'upstream' ? upstreamRoot : nativeRoot;
    if (!root) throw new Error('Missing paste root');
    if (engine === 'upstream') upstream.focus();
    else native.view.focus();
    await new Promise(requestAnimationFrame);
    const tasks: number[] = [];
    const supportsLongTasks =
      PerformanceObserver.supportedEntryTypes.includes('longtask');
    const observer = supportsLongTasks
      ? new PerformanceObserver((list) =>
          tasks.push(...list.getEntries().map((entry) => entry.duration))
        )
      : undefined;
    observer?.observe({ type: 'longtask' });
    let frame = 0;
    let previous = performance.now();
    let started = false;
    let start = 0;
    let maxFrameGap = 0;
    const tick = (now: number) => {
      if (started) {
        maxFrameGap = Math.max(maxFrameGap, now - previous);
        previous = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    let release: (() => void) | undefined;
    const beforeText = root.textContent;
    let pasteEvent: ClipboardEvent | undefined;
    let types: string[] = [];
    const recordPaste = (event: ClipboardEvent) => {
      start = performance.now();
      previous = start;
      started = true;
      maxFrameGap = 0;
      tasks.length = 0;
      observer?.takeRecords();
      types = Array.from(event.clipboardData?.types ?? []);
      pasteEvent = event;
    };
    root.addEventListener('paste', recordPaste, { capture: true, once: true });
    const committed = new Promise<void>((resolve) => {
      const done = () => {
        if (root.textContent === beforeText) return;
        release?.();
        resolve();
      };
      release =
        engine === 'upstream'
          ? upstream.registerUpdateListener(done)
          : native.view.onCommit(done);
    });
    const transfer = new DataTransfer();
    transfer.setData('text/html', html);
    transfer.setData('text/plain', text);
    try {
      if (delivery === 'synthetic') {
        root.dispatchEvent(
          new ClipboardEvent('paste', {
            clipboardData: transfer,
            bubbles: true,
            cancelable: true,
          })
        );
      } else {
        root.dataset.pasteReady = 'true';
      }
      await committed;
      root.lastElementChild?.getBoundingClientRect();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      tasks.push(
        ...(observer?.takeRecords().map((entry) => entry.duration) ?? [])
      );
      return {
        duration: performance.now() - start,
        maxFrameGap,
        tasks,
        supportsLongTasks,
        prevented: pasteEvent?.defaultPrevented ?? false,
        trusted: pasteEvent?.isTrusted ?? false,
        types,
        delivery,
      };
    } finally {
      delete root.dataset.pasteReady;
      root.removeEventListener('paste', recordPaste, true);
      release?.();
      observer?.disconnect();
      cancelAnimationFrame(frame);
    }
  },
  snapshot(engine: 'upstream' | 'native') {
    const root = engine === 'upstream' ? upstreamRoot : nativeRoot;
    if (!root) throw new Error('Missing snapshot root');
    return {
      markdownTarget: 'external',
      model:
        engine === 'upstream'
          ? JSON.stringify(upstream.getEditorState().toJSON())
          : native.port.query({ kind: 7, key: 0, flags: 0, text: '' }).text,
      markdown:
        engine === 'upstream'
          ? upstream
              .getEditorState()
              .read(() => $convertToMarkdownString(EXTERNAL_TRANSFORMERS))
          : native.executor.session.markdown(1),
      html: root.innerHTML,
      dom: Array.from(root.childNodes).map(normalizedDOM),
      text: root.textContent,
      paragraphs: root.querySelectorAll('p').length,
    };
  },
};
Object.assign(window, { largePaste });
window.resolveLargePasteReady();
declare global {
  interface Window {
    largePaste: typeof largePaste;
    largePasteReady: Promise<void>;
    resolveLargePasteReady(): void;
  }
}
