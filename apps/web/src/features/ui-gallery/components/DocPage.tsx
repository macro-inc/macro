import { Badge } from '@ui';
import { createResource, For, Show } from 'solid-js';
import type { DocEntry } from '../registry';
import { extractDemoSource } from '../source';
import type { DocDemo, DocStatus } from '../types';
import { CodeBlock } from './CodeBlock';
import { DemoPreview, type PreviewSettings } from './DemoPreview';
import { PropsTable } from './PropsTable';

const STATUS_LABEL: Record<DocStatus, string> = {
  stable: 'Stable',
  beta: 'Beta',
  deprecated: 'Deprecated',
  internal: 'Internal',
};

function DemoSection(props: {
  demo: DocDemo;
  source: string | undefined;
  settings: PreviewSettings;
}) {
  return (
    <section class="flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <h3 class="text-base font-medium text-ink">{props.demo.title}</h3>
        <Show when={props.demo.description}>
          <p class="text-sm text-ink-muted">{props.demo.description}</p>
        </Show>
      </div>

      <DemoPreview
        settings={props.settings}
        depth={props.demo.depth}
        fill={props.demo.fill}
      >
        {props.demo.render()}
      </DemoPreview>

      <Show
        when={props.source}
        fallback={
          <p class="text-xs text-ink-subtle">
            No source found. Wrap this demo in{' '}
            <code class="font-mono text-ink-muted">
              {`// #region demo:${props.demo.id}`}
            </code>{' '}
            / <code class="font-mono text-ink-muted">{'// #endregion'}</code> to
            show its code here.
          </p>
        }
      >
        {(source) => <CodeBlock code={source()} />}
      </Show>
    </section>
  );
}

/** One component's page: header, demos with source, props, and guidelines. */
export function DocPage(props: { entry: DocEntry; settings: PreviewSettings }) {
  // Raw file text is fetched per page rather than bundled with the registry, so
  // the gallery chunk stays free of a second copy of every docs file.
  const [source] = createResource(
    () => props.entry,
    (entry) => entry.loadSource()
  );

  const sourceFor = (demo: DocDemo) => {
    const text = source();
    if (!text) return undefined;
    return extractDemoSource(text, demo.id) ?? undefined;
  };

  return (
    <article class="flex flex-col gap-10 max-w-3xl">
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
        <Show when={props.entry.doc.import}>
          {(line) => <CodeBlock compact code={line()} />}
        </Show>
      </header>

      <div class="flex flex-col gap-10">
        <For each={props.entry.doc.demos}>
          {(demo) => (
            <DemoSection
              demo={demo}
              source={sourceFor(demo)}
              settings={props.settings}
            />
          )}
        </For>
      </div>

      <Show when={props.entry.doc.props?.length}>
        <section class="flex flex-col gap-3">
          <h2 class="text-lg font-semibold text-ink">Props</h2>
          <PropsTable props={props.entry.doc.props!} />
        </section>
      </Show>

      <Show when={props.entry.doc.guidelines}>
        {(guidelines) => (
          <section class="flex flex-col gap-3">
            <h2 class="text-lg font-semibold text-ink">Guidelines</h2>
            <div class="grid gap-4 sm:grid-cols-2">
              <Show when={guidelines().do?.length}>
                <div class="flex flex-col gap-2 rounded-md border border-edge-muted p-3">
                  <span class="text-xs font-medium text-success">Do</span>
                  <ul class="flex flex-col gap-1.5">
                    <For each={guidelines().do}>
                      {(item) => <li class="text-sm text-ink-muted">{item}</li>}
                    </For>
                  </ul>
                </div>
              </Show>
              <Show when={guidelines().dont?.length}>
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
