import { render } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { beginInteraction, TraceFlow, usePending } from './flow';

type Recorded = {
  name: string;
  parent: string | undefined;
  attrs: Record<string, unknown>;
  events: string[];
  ended: boolean;
};

const { spans, operations } = vi.hoisted(() => ({
  spans: [] as Recorded[],
  operations: [] as { name: string; outcome: string | undefined }[],
}));

vi.mock('./ui-operation', () => {
  function makeSpan(name: string, parent: string | undefined) {
    const record: Recorded = {
      name,
      parent,
      attrs: {},
      events: [],
      ended: false,
    };
    spans.push(record);
    const span = {
      span: (child: string) => makeSpan(child, name),
      run: <T,>(work: () => T) => work(),
      setAttr: (key: string, value: unknown) => {
        record.attrs[key] = value;
      },
      event: (event: string) => record.events.push(event),
      error: () => {},
      end: () => {
        record.ended = true;
      },
    };
    return span;
  }
  return {
    startUiOperation: (name: string) => {
      const operation = { name, outcome: undefined as string | undefined };
      operations.push(operation);
      return {
        span: makeSpan(name, undefined),
        get ended() {
          return operation.outcome !== undefined;
        },
        afterPaint: () => {
          operation.outcome ??= 'painted';
        },
        cancel: () => {
          operation.outcome ??= 'cancelled';
        },
        finish: (outcome = 'success') => {
          operation.outcome ??= outcome;
        },
      };
    },
  };
});

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('TraceFlow', () => {
  beforeEach(() => {
    spans.length = 0;
    operations.length = 0;
  });

  it('stays open until every pending phase under it has loaded', async () => {
    const [items, setItems] = createSignal(true);
    const [preview, setPreview] = createSignal(true);
    function Items() {
      usePending('home.items', items);
      return null;
    }
    function Preview() {
      usePending('home.preview', preview);
      return null;
    }
    render(() => (
      <TraceFlow name="home.load">
        <Items />
        <Preview />
      </TraceFlow>
    ));
    await flush();
    expect(operations).toEqual([{ name: 'home.load', outcome: undefined }]);

    setItems(false);
    await flush();
    expect(spans.find((span) => span.name === 'home.items')).toMatchObject({
      parent: 'home.load',
      ended: true,
      attrs: { 'flow.outcome': 'success' },
    });
    expect(operations[0].outcome).toBeUndefined();

    setPreview(false);
    await flush();
    expect(operations[0].outcome).toBe('painted');
  });

  it('records a phase that was already loaded as an event, not a span', async () => {
    function Cached() {
      usePending('home.items', () => false);
      return null;
    }
    render(() => (
      <TraceFlow name="home.load">
        <Cached />
      </TraceFlow>
    ));
    await flush();
    expect(spans.map((span) => span.name)).toEqual(['home.load']);
    expect(spans[0].events).toEqual(['home.items.ready']);
    expect(operations[0].outcome).toBe('painted');
  });

  it('records a flow that unmounts while loading as cancelled', async () => {
    const [shown, setShown] = createSignal(true);
    function Loading() {
      usePending('doc.content', () => true);
      return null;
    }
    render(() => (
      <Show when={shown()}>
        <TraceFlow name="doc.view">
          <Loading />
        </TraceFlow>
      </Show>
    ));
    await flush();
    setShown(false);
    expect(operations[0].outcome).toBe('cancelled');
    expect(spans.find((span) => span.name === 'doc.content')).toMatchObject({
      ended: true,
      attrs: { 'flow.outcome': 'cancelled' },
    });
  });

  it('joins the interaction that opened it, so the trace runs from input to the view', async () => {
    const [loading, setLoading] = createSignal(true);
    function Content() {
      usePending('doc.content', loading);
      return null;
    }
    const interaction = beginInteraction('nav.open');
    render(() => (
      <TraceFlow name="doc.view">
        <Content />
      </TraceFlow>
    ));
    interaction.end();
    await flush();
    expect(operations).toEqual([{ name: 'nav.open', outcome: undefined }]);
    expect(spans.find((span) => span.name === 'doc.view')?.parent).toBe(
      'nav.open'
    );

    setLoading(false);
    await flush();
    expect(operations[0].outcome).toBe('painted');
  });

  it('ends an interaction that opened no view one paint after it ends', async () => {
    beginInteraction('panel.toggle').end();
    expect(operations).toEqual([{ name: 'panel.toggle', outcome: 'painted' }]);
  });

  it('starts a new trace instead of joining a flow that timed out', async () => {
    const [later, setLater] = createSignal(false);
    function Stuck() {
      usePending('home.items', () => true);
      return null;
    }
    render(() => (
      <TraceFlow name="home.load">
        <Stuck />
        <Show when={later()}>
          <TraceFlow name="settings.view">{null}</TraceFlow>
        </Show>
      </TraceFlow>
    ));
    await flush();
    operations[0].outcome = 'timeout';
    setLater(true);
    expect(operations.map((operation) => operation.name)).toEqual([
      'home.load',
      'settings.view',
    ]);
  });

  it('starts again when its key changes in place, joining the navigation that changed it', async () => {
    const [id, setId] = createSignal('a');
    const [loading, setLoading] = createSignal(false);
    function Content() {
      usePending('doc.content', loading);
      return null;
    }
    render(() => (
      <TraceFlow name="view.doc" key={id}>
        <Content />
      </TraceFlow>
    ));
    await flush();
    expect(operations).toEqual([{ name: 'view.doc', outcome: 'painted' }]);

    const navigation = beginInteraction('navigation');
    setId('b');
    setLoading(true);
    navigation.end();
    await flush();
    expect(
      spans.filter((span) => span.name === 'view.doc').at(-1)?.parent
    ).toBe('navigation');
    expect(spans.find((span) => span.name === 'doc.content')).toMatchObject({
      parent: 'view.doc',
      ended: false,
    });
    expect(operations[1]).toEqual({ name: 'navigation', outcome: undefined });

    setLoading(false);
    await flush();
    expect(operations[1].outcome).toBe('painted');
  });

  it('moves a still-pending phase to each restart of a keyed flow', async () => {
    const [query, setQuery] = createSignal('a');
    const [searching, setSearching] = createSignal(true);
    function Results() {
      usePending('search.results', searching);
      return null;
    }
    render(() => (
      <TraceFlow name="search.flow" key={query}>
        <Results />
      </TraceFlow>
    ));
    await flush();
    setQuery('ab');
    await flush();
    setQuery('abc');
    await flush();
    const phases = spans.filter((span) => span.name === 'search.results');
    expect(phases.map((span) => span.attrs['flow.outcome'])).toEqual([
      'cancelled',
      'cancelled',
      undefined,
    ]);
    expect(operations.map((operation) => operation.outcome)).toEqual([
      'cancelled',
      'cancelled',
      undefined,
    ]);

    setSearching(false);
    await flush();
    expect(operations.at(-1)?.outcome).toBe('painted');
  });

  it('makes an interaction begun inside another a phase of it', () => {
    const outer = beginInteraction('app.boot');
    const inner = beginInteraction('navigation');
    inner.end();
    expect(operations.map((operation) => operation.name)).toEqual(['app.boot']);
    expect(spans.find((span) => span.name === 'navigation')?.parent).toBe(
      'app.boot'
    );
    outer.end();
    expect(operations[0].outcome).toBe('painted');
  });

  it('lets only the first view join an interaction that closes on join', async () => {
    const boot = beginInteraction('app.boot', { closeOnJoin: true });
    render(() => <TraceFlow name="view.home">{null}</TraceFlow>);
    render(() => <TraceFlow name="view.settings">{null}</TraceFlow>);
    await flush();
    expect(spans.find((span) => span.name === 'view.home')?.parent).toBe(
      'app.boot'
    );
    expect(operations.map((operation) => operation.name)).toEqual([
      'app.boot',
      'view.settings',
    ]);
    expect(operations[0].outcome).toBe('painted');
    boot.end();
  });

  it('starts its own trace once the flow it is nested in has settled', async () => {
    const [later, setLater] = createSignal(false);
    render(() => (
      <TraceFlow name="app.shell">
        <Show when={later()}>
          <TraceFlow name="settings.view">{null}</TraceFlow>
        </Show>
      </TraceFlow>
    ));
    await flush();
    setLater(true);
    await flush();
    expect(operations.map((operation) => operation.name)).toEqual([
      'app.shell',
      'settings.view',
    ]);
  });
});
