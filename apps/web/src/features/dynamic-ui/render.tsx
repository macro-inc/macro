import { createMemo, ErrorBoundary, For, type JSX, Suspense } from 'solid-js';
import { match } from 'ts-pattern';
import { Col, Row, View } from './core/Layout';
import type {
  View as ComposedView,
  Widget,
  WidgetOf,
  WidgetType,
} from './schema';
import { Card } from './widgets/Card';
import { ChannelMessage } from './widgets/ChannelMessage';
import { List } from './widgets/List';
import { Md } from './widgets/Md';
import { Stat } from './widgets/Stat';
import { Timeline } from './widgets/Timeline';

/**
 * The single, exhaustive node renderer. One `match()` arm per widget `type`
 * dispatches to its real-props component, spreading the schema node directly.
 * The `container` arm recurses through {@link Container}. There is no registry
 * and no `<Dynamic>`: adding a widget means adding one arm here (and the
 * `.exhaustive()` keeps it honest).
 */
export function Render(props: { node: Widget }): JSX.Element {
  return match(props.node)
    .with({ type: 'md' }, (n) => <Md {...n} />)
    .with({ type: 'stat' }, (n) => <Stat {...n} />)
    .with({ type: 'timeline' }, (n) => <Timeline {...n} />)
    .with({ type: 'card' }, (n) => <Card {...n} />)
    .with({ type: 'channelMessage' }, (n) => <ChannelMessage {...n} />)
    .with({ type: 'list' }, (n) => <List {...n} />)
    .with({ type: 'container' }, (n) => <Container node={n} />)
    .exhaustive();
}

/**
 * Widgets that must always span the full width of their container — they never
 * share a horizontal row, so e.g. a `list` dropped into a `row` still renders
 * full-width on its own line instead of being squished into a column.
 */
const FULL_WIDTH_TYPES: ReadonlySet<WidgetType> = new Set<WidgetType>(['list']);

/**
 * Renders a `container` node: picks {@link RowLayout} or {@link Col} by
 * `direction` (defaulting to a column) and recurses each child through
 * {@link Render}. In a column every child is already full width.
 */
function Container(props: { node: WidgetOf<'container'> }): JSX.Element {
  const node = () => props.node;
  return match(node().direction)
    .with('row', () => <RowLayout node={node()} />)
    .otherwise(() => (
      <Col gap={node().gap} align={node().align} justify={node().justify}>
        <For each={node().children}>{(child) => <Render node={child} />}</For>
      </Col>
    ));
}

type RowSegment =
  | { full: true; item: Widget }
  | { full: false; items: Widget[] };

/**
 * Lays out a `row` container: full-width-only widgets ({@link FULL_WIDTH_TYPES})
 * break onto their own full-width line, while runs of normal widgets share a
 * row. Segments stack in a column.
 */
function RowLayout(props: { node: WidgetOf<'container'> }): JSX.Element {
  const segments = createMemo<RowSegment[]>(() => {
    const out: RowSegment[] = [];
    let run: Widget[] = [];
    const flush = () => {
      if (run.length > 0) {
        out.push({ full: false, items: run });
        run = [];
      }
    };
    for (const child of props.node.children) {
      if (FULL_WIDTH_TYPES.has(child.type)) {
        flush();
        out.push({ full: true, item: child });
      } else {
        run.push(child);
      }
    }
    flush();
    return out;
  });

  return (
    <Col gap={props.node.gap}>
      <For each={segments()}>
        {(seg) =>
          seg.full ? (
            <Render node={seg.item} />
          ) : (
            <Row
              gap={props.node.gap}
              align={props.node.align}
              justify={props.node.justify}
              wrap={props.node.wrap}
            >
              <For each={seg.items}>{(item) => <Render node={item} />}</For>
            </Row>
          )
        }
      </For>
    </Col>
  );
}

/**
 * Renders a composed view: the layout {@link View} shell with each top-level
 * widget mapped through {@link Render}. The whole tree is wrapped in ONE
 * ErrorBoundary + Suspense (per the entity-lib idiom — the exhaustive match
 * makes per-widget boundaries unnecessary).
 */
export function Compose(props: { view: ComposedView }): JSX.Element {
  return (
    <ErrorBoundary
      fallback={(err) => (
        <div class="border-edge-muted text-ink-extra-muted rounded border border-dashed p-3 text-xs">
          Failed to render view: {String(err)}
        </div>
      )}
    >
      <Suspense
        fallback={<div class="text-ink-muted p-3 text-sm">Loading…</div>}
      >
        <View title={props.view.title}>
          <For each={props.view.widgets}>
            {(widget) => <Render node={widget} />}
          </For>
        </View>
      </Suspense>
    </ErrorBoundary>
  );
}
