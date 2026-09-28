import {
  StaticLexical,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  plainRichText,
  type RichText,
  type TextGeometry,
  type TextMeasurer,
} from '@macro-inc/graphics';
import { textLayoutStyle } from '@macro-inc/graphics/browser';
import { createSignal, ErrorBoundary } from 'solid-js';
import { render } from 'solid-js/web';
import './text.css';

export function CanvasTextContent(props: { content: RichText }) {
  return (
    <div class="canvas-lexical-text">
      <ErrorBoundary fallback={<span>Unsupported text</span>}>
        <StaticLexical serializedState={props.content} />
      </ErrorBoundary>
    </div>
  );
}

/** Layout uses the same shared Lexical renderer as the visible canvas items. */
export function createCanvasTextMeasurer() {
  const element = document.createElement('div');
  element.className = 'graphics-rich-text';
  Object.assign(element.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    visibility: 'hidden',
    pointerEvents: 'none',
  });
  element.setAttribute('aria-hidden', 'true');
  document.body.append(element);
  const [content, setContent] = createSignal(plainRichText());
  const dispose = render(
    () => (
      <StaticMarkdownContext>
        <CanvasTextContent content={content()} />
      </StaticMarkdownContext>
    ),
    element
  );
  const measure: TextMeasurer = (geometry: TextGeometry) => {
    for (const [key, value] of Object.entries(textLayoutStyle(geometry)))
      element.style.setProperty(key, value);
    setContent(geometry.content);
    const rect = element.getBoundingClientRect();
    return {
      width: geometry.autoWidth ? Math.max(1, rect.width) : geometry.width,
      height: Math.max(geometry.fontSize * 1.35, rect.height),
    };
  };
  return {
    measure,
    dispose: () => {
      dispose();
      element.remove();
    },
  };
}
