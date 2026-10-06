// Tool rows for the Photoshop and Illustrator document readers.
import { ItemPreview } from '@core/component/ItemPreview';
import PenNibIcon from '@phosphor/pen-nib.svg';
import StackIcon from '@phosphor/stack.svg';
import {
  type Component,
  createSignal,
  type JSX,
  Show,
  Suspense,
} from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer, type RenderContext } from './ToolRenderer';

/** Layer count from the first line of a ReadPhotoshopDocument description. */
export function describedLayerCount(content: string): number | undefined {
  const firstLine = content.split('\n', 1)[0] ?? '';
  const match = /^Photoshop document: .*, (\d+) layers?$/.exec(firstLine);
  return match ? Number(match[1]) : undefined;
}

/** Artboard count from the first line of a ReadIllustratorDocument description. */
export function describedArtboardCount(content: string): number | undefined {
  const match = /^Illustrator document: (\d+) artboards?,/.exec(content);
  return match ? Number(match[1]) : undefined;
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function DesignDocumentToolRow(props: {
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  kind: string;
  documentId: string;
  summary?: string;
  details?: string;
  renderContext: RenderContext['renderContext'];
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <BaseTool
      icon={props.icon}
      type="call"
      renderContext={props.renderContext}
      response={
        <Show when={expanded() && props.details}>
          {(details) => (
            <pre class="max-h-80 overflow-auto whitespace-pre-wrap pb-1 font-mono text-ink text-xs">
              {details()}
            </pre>
          )}
        </Show>
      }
    >
      <div class="flex items-center gap-2">
        <div class="min-w-0 flex-1">
          Read <span class="text-ink">{props.kind}</span>{' '}
          <span class="text-ink-placeholder">·</span>{' '}
          <Suspense>
            <ItemPreview
              class="inline-flex align-middle ring-0"
              id={props.documentId}
              type="document"
            />
          </Suspense>
        </div>
        <Show when={props.summary}>
          <Tool.ResultToggle
            expanded={expanded()}
            showToggle={!!props.details}
            onToggle={() => setExpanded((value) => !value)}
            status={<span>{props.summary}</span>}
          />
        </Show>
      </div>
    </BaseTool>
  );
}

export const readPhotoshopDocumentHandler = createToolRenderer({
  name: 'ReadPhotoshopDocument',
  render: (ctx) => {
    const content = () => ctx.response?.data.content;
    const summary = () => {
      const text = content();
      if (text === undefined) return undefined;
      const count = describedLayerCount(text);
      return count === undefined ? 'Read' : plural(count, 'layer');
    };
    return (
      <DesignDocumentToolRow
        icon={StackIcon}
        kind="Photoshop document"
        documentId={ctx.tool.data.documentId}
        summary={summary()}
        details={content()}
        renderContext={ctx.renderContext}
      />
    );
  },
});

export const readIllustratorDocumentHandler = createToolRenderer({
  name: 'ReadIllustratorDocument',
  render: (ctx) => {
    const content = () => ctx.response?.data.content;
    const summary = () => {
      const text = content();
      if (text === undefined) return undefined;
      const count = describedArtboardCount(text);
      return count === undefined ? 'Read' : plural(count, 'artboard');
    };
    return (
      <DesignDocumentToolRow
        icon={PenNibIcon}
        kind="Illustrator document"
        documentId={ctx.tool.data.documentId}
        summary={summary()}
        details={content()}
        renderContext={ctx.renderContext}
      />
    );
  },
});
