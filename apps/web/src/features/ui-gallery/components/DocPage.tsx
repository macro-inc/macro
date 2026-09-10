import { Badge } from '@ui';
import { createResource, For, Show } from 'solid-js';
import { type DocEntry, loadTypeSource } from '../registry';
import { extractDemoSource, extractGuidelines } from '../source';
import type { DocDemo, DocStatus } from '../types';
import { CodeBlock } from './CodeBlock';
import { DemoPreview } from './DemoPreview';

const STATUS_LABEL: Record<DocStatus, string> = {
  stable: 'Stable',
  beta: 'Beta',
  deprecated: 'Deprecated',
  internal: 'Internal',
};

function DemoSection(props: {
  demo: DocDemo;
  source: string | undefined;
  showCode: boolean;
}) {
  return (
    <section class="flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <h3 class="text-base font-medium text-ink">{props.demo.title}</h3>
        <Show when={props.demo.description}>
          <p class="text-sm text-ink-muted">{props.demo.description}</p>
        </Show>
      </div>

      <DemoPreview depth={props.demo.depth} fill={props.demo.fill}>
        {props.demo.render()}
      </DemoPreview>

      <Show when={props.showCode}>
        <Show
          when={props.source}
          fallback={
            <p class="text-xs text-ink-subtle">
              No source found. Wrap this demo in{' '}
              <code class="font-mono text-ink-muted">
                {`// #region demo:${props.demo.id}`}
              </code>{' '}
              / <code class="font-mono text-ink-muted">{'// #endregion'}</code>{' '}
              to show its code here.
            </p>
          }
        >
          {(source) => <CodeBlock code={source()} />}
        </Show>
      </Show>
    </section>
  );
}

/** One component's page: header, demos with source, props, and guidelines. */
export function DocPage(props: { entry: DocEntry; showCode: boolean }) {
  // Raw file text is fetched per page rather than bundled with the registry, so
  // the gallery chunk stays free of a second copy of every docs file.
  const [source] = createResource(
    () => (props.showCode ? props.entry : undefined),
    (entry) => entry.loadSource()
  );

  // The implementation is the source of truth for guidance and prop types, so
  // neither is restated in the docs file.
  const [componentSource] = createResource(
    () => props.entry,
    (entry) => entry.loadComponentSource?.() ?? null
  );

  // Reading a resource value suspends the nearest <Suspense> while it is
  // pending, and the split layout's boundary has no fallback (SplitLayout.tsx),
  // so an unguarded read blanks the entire pane with no console error. Every
  // read below is gated on state; reading `.state` itself never suspends.
  const docText = () => (source.state === 'ready' ? source() : undefined);
  const componentText = () =>
    componentSource.state === 'ready' ? componentSource() : undefined;
  const resolvedPropTypes = () =>
    propTypes.state === 'ready' ? (propTypes() ?? []) : [];

  const guidelines = () => {
    const component = componentText();
    const fromCode = component
      ? extractGuidelines(component)
      : { do: [], dont: [] };
    if (fromCode.do.length || fromCode.dont.length) return fromCode;
    // Foundations pages have no component to annotate.
    const inline = props.entry.doc.guidelines;
    return inline ? { do: inline.do ?? [], dont: inline.dont ?? [] } : null;
  };

  const [propTypes] = createResource(
    () => (props.showCode ? props.entry : undefined),
    async (entry) => {
      const names = entry.doc.propTypes ?? [
        `${entry.doc.name.replace(/\s+/g, '')}Props`,
      ];
      const found = await Promise.all(
        names.map((name) => loadTypeSource(name))
      );
      return found.filter((value): value is string => Boolean(value));
    }
  );

  const sourceFor = (demo: DocDemo) => {
    const text = docText();
    if (!text) return undefined;
    return extractDemoSource(text, demo.id) ?? undefined;
  };

  return (
    <article class="flex flex-col gap-10 max-w-3xl mx-auto">
      <header class="flex flex-col gap-3">
        <div class="flex items-center gap-2">
          <h1 class="text-2xl font-semibold text-ink">
            {props.entry.doc.name}
          </h1>
          <Show when={props.entry.doc.status}>
            {(status) => (
              <Badge variant="outline" size="sm">
                {STATUS_LABEL[status()]}
              </Badge>
            )}
          </Show>
        </div>
        <p class="text-sm text-ink-muted">{props.entry.doc.description}</p>
        <Show when={props.showCode}>
          <Show when={props.entry.doc.import}>
            {(line) => <CodeBlock compact code={line()} />}
          </Show>
        </Show>
      </header>

      <div class="flex flex-col gap-10">
        <For each={props.entry.doc.demos}>
          {(demo) => (
            <DemoSection
              demo={demo}
              source={sourceFor(demo)}
              showCode={props.showCode}
            />
          )}
        </For>
      </div>

      <Show when={props.showCode && resolvedPropTypes().length}>
        <section class="flex flex-col gap-3">
          <h2 class="text-lg font-semibold text-ink">Props</h2>
          <p class="text-sm text-ink-muted">
            Read straight from the component, so it cannot drift.
          </p>
          <For each={resolvedPropTypes()}>
            {(declaration) => <CodeBlock code={declaration} />}
          </For>
        </section>
      </Show>

      <Show when={guidelines()}>
        {(guidelines) => (
          <section class="flex flex-col gap-3">
            <h2 class="text-lg font-semibold text-ink">Guidelines</h2>
            <div class="grid gap-4 sm:grid-cols-2">
              <Show when={guidelines().do.length}>
                <div class="flex flex-col gap-2 rounded-md border border-edge-muted p-3">
                  <span class="text-xs font-medium text-success">Do</span>
                  <ul class="flex flex-col gap-1.5">
                    <For each={guidelines().do}>
                      {(item) => <li class="text-sm text-ink-muted">{item}</li>}
                    </For>
                  </ul>
                </div>
              </Show>
              <Show when={guidelines().dont.length}>
                <div class="flex flex-col gap-2 rounded-md border border-edge-muted p-3">
                  <span class="text-xs font-medium text-failure">Don't</span>
                  <ul class="flex flex-col gap-1.5">
                    <For each={guidelines().dont}>
                      {(item) => <li class="text-sm text-ink-muted">{item}</li>}
                    </For>
                  </ul>
                </div>
              </Show>
            </div>
          </section>
        )}
      </Show>

      <footer class="pt-2 border-t border-edge-muted">
        <p class="text-xs text-ink-subtle">
          Edit this page at{' '}
          <code class="font-mono">apps/web/{props.entry.path}</code>
        </p>
      </footer>
    </article>
  );
}
