import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { StaticCodeBoxAccessory } from '../component/LexicalMarkdown/component/accessory/CodeBoxAccessory';
import { theme } from '../component/LexicalMarkdown/theme';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe() {
        queueMicrotask(() => this.callback([], this));
      }
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

for (const [name, code, outcome] of [
  [
    'valid',
    '<svg data-code-preview-test="true" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
    'svg',
  ],
  [
    'script and handler',
    '<svg data-code-preview-test="true" onload="window.previewExecuted=true"><script>window.previewExecuted=true</script><rect fill="javascript:red"/></svg>',
    'svg',
  ],
  ['invalid', 'not SVG', 'Invalid SVG content'],
  ['empty', ' \n ', 'No SVG content'],
] as const) {
  test(`actual Source SVG preview: ${name}`, () => {
    const result = render(() => (
      <StaticCodeBoxAccessory
        language="svg"
        code={code}
        theme={theme}
        isPreviewMode={() => true}
      />
    ));
    if (outcome === 'svg') {
      const image = result.getByAltText('SVG preview');
      expect(image.tagName).toBe('IMG');
      const src = image.getAttribute('src');
      if (!src) throw new Error('Missing SVG image URL');
      const prefix = 'data:image/svg+xml;charset=utf-8,';
      expect(src.startsWith(prefix)).toBe(true);
      const serialized = decodeURIComponent(src.slice(prefix.length));
      const parsed = new DOMParser().parseFromString(
        serialized,
        'image/svg+xml'
      );
      expect(
        parsed.querySelector('svg[data-code-preview-test]')
      ).not.toBeNull();
      // Author markup belongs to the isolated image document, never the page.
      expect(
        result.container.querySelector('svg[data-code-preview-test]')
      ).toBeNull();
      expect(result.container.querySelector('script')).toBeNull();
      expect(result.container.querySelector('[onload]')).toBeNull();
      expect(result.container.innerHTML.includes('javascript:')).toBe(false);
    } else expect(result.container.textContent).toContain(outcome);
  });
}

test('Source hidden preview leaves content absent and toggle remains available', () => {
  const result = render(() => (
    <StaticCodeBoxAccessory
      language="svg"
      code='<svg data-code-preview-test="true"><rect/></svg>'
      theme={theme}
    />
  ));
  expect(
    result.container.querySelector('svg[data-code-preview-test]')
  ).toBeNull();
  expect(result.getByLabelText('Preview')).toBeDefined();
});
