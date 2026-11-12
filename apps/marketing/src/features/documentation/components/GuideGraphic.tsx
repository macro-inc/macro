import { lazy, Show } from 'solid-js';
import { DeferredDemo } from '../../marketing/components/DeferredDemo';
import type { HomepagePreviewKind } from '../../marketing/components/homepage/HomepageProductPreview';
import '../../marketing/components/workspace-story.css';
import './guide-graphic.css';

const loadProduct = () =>
  import('../../marketing/components/homepage/HomepageProductPreview');
const ProductGraphic = lazy(loadProduct);
const loadWorkspace = () => import('./GuideWorkspaceGraphic');
const WorkspaceGraphic = lazy(loadWorkspace);
const loadTool = () => import('./GuideToolGraphic');
const ToolGraphic = lazy(loadTool);
export type GuideGraphicKind =
  | HomepagePreviewKind
  | 'inbox'
  | 'search'
  | 'tags'
  | 'calendar'
  | 'canvas'
  | 'snippets';

/** The guides and feature pages share the same illustrative product scenes. */
export function GuideGraphic(props: { kind: GuideGraphicKind; label: string }) {
  const workspaceKind = () => {
    const kind = props.kind;
    return kind === 'inbox' || kind === 'search' || kind === 'tags'
      ? kind
      : undefined;
  };
  const toolKind = () => {
    const kind = props.kind;
    return kind === 'calendar' || kind === 'canvas' || kind === 'snippets'
      ? kind
      : undefined;
  };
  const productKind = () => {
    const kind = props.kind;
    return kind === 'inbox' ||
      kind === 'search' ||
      kind === 'tags' ||
      kind === 'calendar' ||
      kind === 'canvas' ||
      kind === 'snippets'
      ? undefined
      : kind;
  };
  return (
    <figure
      class="guide-graphic"
      data-kind={props.kind}
      aria-label={props.label}
    >
      <DeferredDemo
        preload={
          workspaceKind() ? loadWorkspace : toolKind() ? loadTool : loadProduct
        }
        fallback={
          <div
            class="guide-graphic-loading"
            role="img"
            aria-label={props.label}
          />
        }
      >
        <Show when={workspaceKind()}>
          {(kind) => <WorkspaceGraphic kind={kind()} label={props.label} />}
        </Show>
        <Show when={toolKind()}>{(kind) => <ToolGraphic kind={kind()} />}</Show>
        <Show when={productKind()}>
          {(kind) => <ProductGraphic kind={kind()} />}
        </Show>
      </DeferredDemo>
    </figure>
  );
}
