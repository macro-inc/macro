/** @vitest-environment jsdom */
import { CommandCode } from '@macro-inc/collaboration/session/abi.generated';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { Telemetry } from '@macro-inc/observability';
import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { installNativeMarkdownOverlays } from '../installNativeMarkdownOverlays';
import table from '../table-hover-browser-test/fixtures/table.json';
import { createNativeTableHoverHost } from './native-table-hover';

beforeAll(initializeNativeSurfaceTests);
/** jsdom has no ResizeObserver; the table resizer registers one on mount. */
class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => vi.stubGlobal('ResizeObserver', TestResizeObserver));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test.each([undefined, null, { fault: 'table facts' }])(
  'a real healthy table UI retires only its own scope after query failure %s',
  (cause) => {
    const fixture = nativeSurface();
    fixture.port.setState(JSON.stringify(table));
    const cell = fixture.root.querySelectorAll('td')[3];
    const tableDOM = fixture.root.querySelector('table');
    if (!cell || !tableDOM) throw new Error('Missing actual native table');
    vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(20, 60, 100, 40)
    );
    vi.spyOn(tableDOM, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(20, 20, 300, 120)
    );
    const installation = installNativeMarkdownOverlays(fixture.view, {
      canEdit: () => true,
    });
    const container = document.createElement('div');
    document.body.append(container);
    const unmount = render(
      () => installation.Overlays && createComponent(installation.Overlays, {}),
      container
    );
    const originalQuery = fixture.port.query.bind(fixture.port);
    let fail = false;
    let queries = 0;
    vi.spyOn(fixture.port, 'query').mockImplementation((query) => {
      if (
        query.kind === 9 &&
        JSON.parse(query.text).name === 'group-b.table-facts'
      ) {
        queries++;
        if (fail) throw cause;
      }
      return originalQuery(query);
    });
    const telemetry = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
    try {
      cell.dispatchEvent(
        new MouseEvent('pointermove', {
          bubbles: true,
          clientX: 21,
          clientY: 80,
        })
      );
      expect(queries).toBeGreaterThan(0);
      expect(
        document.querySelector('button[aria-label="Delete row"]')
      ).not.toBeNull();
      const healthyQueries = queries;
      const cleanupError = { fault: 'listener cleanup' };
      const remove = fixture.root.removeEventListener.bind(fixture.root);
      vi.spyOn(fixture.root, 'removeEventListener').mockImplementation(
        (type, listener, options) => {
          remove(type, listener, options);
          if (type === 'pointermove') throw cleanupError;
        }
      );
      const before = fixture.session.serializedState();
      fail = true;
      cell.dispatchEvent(
        new MouseEvent('pointermove', {
          bubbles: true,
          clientX: 21,
          clientY: 80,
        })
      );
      expect(queries).toBe(healthyQueries + 1);
      expect(telemetry.mock.calls.some(([error]) => error === cause)).toBe(
        true
      );
      expect(
        telemetry.mock.calls.some(([error]) => error === cleanupError)
      ).toBe(true);
      expect(
        document.querySelector('button[aria-label="Delete row"]')
      ).toBeNull();
      expect(document.querySelectorAll('.draggable-block-menu')).toHaveLength(
        1
      );
      expect(fixture.session.serializedState()).toBe(before);
      cell.dispatchEvent(
        new MouseEvent('pointermove', {
          bubbles: true,
          clientX: 21,
          clientY: 80,
        })
      );
      expect(queries).toBe(healthyQueries + 1);
      const paragraph = cell.querySelector('p');
      const textDOM = paragraph?.firstChild;
      const key = textDOM && fixture.view.keyFromDOM(textDOM);
      if (
        key === null ||
        key === undefined ||
        fixture.view.node(key)?.type !== 'text'
      )
        throw new Error('Missing actual native text');
      fixture.port.selectionFromView({
        kind: 'range',
        anchor: { key, offset: 0, type: 'text' },
        focus: { key, offset: 0, type: 'text' },
      });
      fixture.port.command(CommandCode.InsertText, 0, 0, 'x');
      expect(cell.textContent).toBe('xCell 2:1');
      expect(fixture.view.isMounted).toBe(true);
    } finally {
      unmount();
      installation.dispose();
      installation.dispose();
      container.remove();
      vi.restoreAllMocks();
      fixture.close();
    }
  }
);

test('callback failure cannot mask the original query cause or reenter a retired host', () => {
  const fixture = nativeSurface();
  fixture.port.setState(JSON.stringify(table));
  const primary = { fault: 'query' };
  const secondary = { fault: 'callback' };
  let captured: { value: unknown } | undefined;
  let reenter: (() => void) | undefined;
  const resource = createNativeTableHoverHost(
    fixture.view,
    () => true,
    (error) => {
      captured = { value: error };
      reenter?.();
      throw secondary;
    }
  );
  const telemetry = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
  try {
    const element = fixture.root.querySelector('td');
    const hit = resource.deleteHost.cellFromTarget(element);
    if (!element || !hit) throw new Error('Missing actual captured cell');
    resource.deleteHost.selectionPixels(hit, element.getBoundingClientRect());
    let moves = 0;
    resource.deleteHost.registerRoot(() => moves++);
    reenter = () => resource.deleteHost.deleteAt(hit, 'row');
    const original = fixture.port.query.bind(fixture.port);
    vi.spyOn(fixture.port, 'query').mockImplementation((query) => {
      if (
        query.kind === 9 &&
        JSON.parse(query.text).name === 'group-b.table-facts'
      )
        throw primary;
      return original(query);
    });
    const before = fixture.session.serializedState();
    resource.deleteHost.selectionPixels(hit, element.getBoundingClientRect());
    expect(captured).toEqual({ value: primary });
    expect(telemetry.mock.calls.some(([error]) => error === primary)).toBe(
      true
    );
    expect(telemetry.mock.calls.some(([error]) => error === secondary)).toBe(
      true
    );
    fixture.root.dispatchEvent(new Event('pointermove'));
    expect(moves).toBe(0);
    expect(fixture.session.serializedState()).toBe(before);
    expect(() => resource.deleteHost.registerRoot(() => moves++)).toThrow(
      'Table hover host is disposed'
    );
  } finally {
    resource.dispose();
    fixture.close();
  }
});

test.each([undefined, null, { fault: 'direct facts' }])(
  'without an unavailable callback the retired host preserves its original opaque throw %s',
  (cause) => {
    const fixture = nativeSurface();
    fixture.port.setState(JSON.stringify(table));
    const resource = createNativeTableHoverHost(fixture.view, () => true);
    try {
      const element = fixture.root.querySelector('td');
      const hit = resource.deleteHost.cellFromTarget(element);
      if (!element || !hit) throw new Error('Missing actual captured cell');
      resource.deleteHost.selectionPixels(hit, element.getBoundingClientRect());
      let moves = 0;
      resource.deleteHost.registerRoot(() => moves++);
      const original = fixture.port.query.bind(fixture.port);
      vi.spyOn(fixture.port, 'query').mockImplementation((query) => {
        if (
          query.kind === 9 &&
          JSON.parse(query.text).name === 'group-b.table-facts'
        )
          throw cause;
        return original(query);
      });
      let captured: { value: unknown } | undefined;
      try {
        resource.deleteHost.selectionPixels(
          hit,
          element.getBoundingClientRect()
        );
      } catch (error) {
        captured = { value: error };
      }
      expect(captured).toEqual({ value: cause });
      fixture.root.dispatchEvent(new Event('pointermove'));
      expect(moves).toBe(0);
      resource.dispose();
      resource.dispose();
    } finally {
      resource.dispose();
      fixture.close();
    }
  }
);
