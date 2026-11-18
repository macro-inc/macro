import Copy from '@icon/system/regular/copy.svg';
import DownloadSimple from '@icon/system/regular/download-simple.svg';
import {
  alignCommand,
  canLabel,
  distributeCommand,
  movedInPresentation,
  presentationOrder,
  setArtifactCommand,
  setPresentationOrderCommand,
  styleCommand,
} from '@macro-inc/graphics';
import { Button } from '@ui';
import { createMemo, Show } from 'solid-js';
import { ArtifactInspector } from '../../components/artifact-inspector';
import { ArtifactLibraryInspector } from '../../components/artifact-library-inspector';
import { ConnectorInspector } from '../../components/connector-inspector';
import { SelectionLayoutInspector } from '../../components/selection-layout-inspector';
import { StyleInspector } from '../../components/style-inspector';
import { TextInspector } from '../../components/text-inspector';
import { useArtifactLibrary } from '../../context/artifact-library';
import { setDocumentDisplayCommand } from '../../core/document-display';
import {
  selectionLayoutCommand,
  selectionLayoutInfo,
} from '../../core/selection-layout';
import { useCanvasView } from './canvas-view-parts';

/**
 * Everything the inspector shows for the selection: its name, then position
 * and layout, style, connection, typography, and the selected item's own
 * actions. The view decides where it sits (a side panel, a sheet) and
 * scrolls it.
 */
export function CanvasInspectorSections(sectionProps: {
  /**
   * List colour swatches in the inspector itself: for one too short on room
   * to open a picker beside the shape being coloured.
   */
  swatchRows?: boolean;
}) {
  const view = useCanvasView();
  const { props, state, editor, selectedItem } = view;
  const { lockAspectRatio, setLockAspectRatio } = view;
  const layout = createMemo(() =>
    selectionLayoutInfo(state.snapshot(), state.selection())
  );
  const artifacts = useArtifactLibrary();
  const selectedArtifact = () => {
    const item = selectedItem();
    return item?.type === 'artifact' ? item : undefined;
  };
  const selectedDocument = () => {
    const item = selectedItem();
    return item?.type === 'document' ? item : undefined;
  };
  const styleKinds = () =>
    state.shapes().length
      ? state.shapes().map((item) => item.type)
      : [
          state.tool() === 'select' || state.tool() === 'pan'
            ? 'rectangle'
            : state.tool(),
        ];
  const connectorValue = () => {
    const connectors = state
      .shapes()
      .filter((item) => item.type === 'connector');
    if (!connectors.length) return state.connector.defaults();
    const shared = <K extends 'route' | 'startHead' | 'endHead'>(key: K) => {
      const first = connectors[0]!.geometry[key];
      return connectors.every((item) => item.geometry[key] === first)
        ? first
        : undefined;
    };
    return {
      route: shared('route'),
      startHead: shared('startHead'),
      endHead: shared('endHead'),
    };
  };
  const textGeometry = () => {
    const draft = state.text.draft();
    if (draft) return draft.geometry;
    const item = state.document.items[state.selection()[0]!];
    return item?.type === 'text'
      ? item.geometry
      : canLabel(item) && item.geometry.label
        ? item.geometry.label
        : state.text.defaults();
  };
  const labelSelection = () => {
    const item = state.document.items[state.selection()[0]!];
    return (
      state.selection().length === 1 && canLabel(item) && !!item.geometry.label
    );
  };
  const title = () => {
    if (state.selection().length > 1)
      return `${state.selection().length} selected`;
    const type = selectedItem()?.type;
    if (type) return type;
    return state.tool() === 'select' || state.tool() === 'pan'
      ? 'Canvas'
      : state.tool();
  };

  return (
    <>
      <div class="border-b border-edge-muted px-3 py-3">
        <h1 class="text-xs font-medium capitalize">{title()}</h1>
      </div>

      <SelectionLayoutInspector
        snapUnit={state.snapUnit()}
        lockAspectRatio={lockAspectRatio()}
        onLockAspectRatio={setLockAspectRatio}
        onAlign={(alignment) => editor.execute(alignCommand, alignment)}
        onDistribute={(axis) => editor.execute(distributeCommand, axis)}
        count={layout().count}
        value={(field) => layout().values[field]}
        onChange={(field, value) =>
          editor.execute(selectionLayoutCommand, {
            field,
            value,
            lockAspectRatio: lockAspectRatio(),
          })
        }
        onScrub={(field) => {
          const locked = lockAspectRatio();
          const payload = (value: number) => ({
            field,
            value,
            lockAspectRatio: locked,
          });
          return state.inspector.begin(
            (context, value) =>
              selectionLayoutCommand.apply(context, payload(value)).document,
            (value) => editor.execute(selectionLayoutCommand, payload(value))
          );
        }}
        onTransform={(field) =>
          editor.execute(selectionLayoutCommand, { field })
        }
      />
      <StyleInspector
        swatchRows={sectionProps.swatchRows}
        fill={styleKinds().some(
          (kind) => kind === 'rectangle' || kind === 'ellipse'
        )}
        stroke={styleKinds().some((kind) =>
          [
            'rectangle',
            'ellipse',
            'connector',
            'arrow',
            'line',
            'pencil',
          ].includes(kind)
        )}
        strokePattern={styleKinds().some((kind) =>
          ['rectangle', 'ellipse', 'connector', 'arrow', 'line'].includes(kind)
        )}
        corners={styleKinds().includes('rectangle')}
        text={styleKinds().every((kind) => kind === 'text')}
        canvasColors={state.canvasColors()}
        value={state.appearanceValue}
        onChange={state.style}
        onScrub={(key) => {
          const patch = (value: number) => ({
            [key]: key === 'opacity' ? value / 100 : value,
          });
          return state.inspector.begin(
            (context, value) =>
              styleCommand.apply(context, patch(value)).document,
            (value) => state.style(patch(value))
          );
        }}
      />
      <Show
        when={
          state.isConnectorTool() ||
          state.shapes().some((item) => item.type === 'connector')
        }
      >
        <ConnectorInspector
          value={connectorValue()}
          onChange={state.connector.style}
        />
      </Show>
      <Show
        when={
          state.tool() === 'text' ||
          state.text.draft() ||
          state.shapes().some((item) => item.type === 'text') ||
          labelSelection()
        }
      >
        <TextInspector
          label={
            state.text.isLabel() || (!state.text.draft() && labelSelection())
          }
          geometry={textGeometry()}
          onChange={state.text.typography}
          onScrub={() => state.text.scrubFontSize(state.inspector)}
        />
      </Show>
      <Show when={selectedArtifact()}>
        {(artifact) => (
          <>
            <ArtifactInspector
              item={artifact()}
              onChange={(content) =>
                editor.execute(setArtifactCommand, {
                  id: artifact().id,
                  content,
                })
              }
              position={
                presentationOrder(state.document).findIndex(
                  (item) => item.id === artifact().id
                ) + 1
              }
              count={presentationOrder(state.document).length}
              onPresent={() => view.setPresenting(artifact().id)}
              onMove={(delta) => {
                const ids = movedInPresentation(
                  state.document,
                  artifact().id,
                  delta
                );
                if (ids) editor.execute(setPresentationOrderCommand, { ids });
              }}
            />
            <Show when={artifacts.edit}>
              {(edit) => (
                <ArtifactLibraryInspector
                  library={artifacts.library()}
                  onEdit={edit()}
                />
              )}
            </Show>
          </>
        )}
      </Show>
      <Show when={view.imageActions()}>
        {(actions) => (
          <div class="flex flex-col gap-2 p-3">
            <Button
              variant="ghost"
              size="sm"
              disabled={actions().disabled}
              onClick={() => actions().onCopy()}
            >
              <Copy class="size-3 touch:size-6 shrink-0 pointer-events-none" />
              Copy image
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={actions().disabled}
              onClick={() => actions().onSave()}
            >
              <DownloadSimple class="size-3 touch:size-6 shrink-0 pointer-events-none" />
              Save image
            </Button>
          </div>
        )}
      </Show>
      <Show when={selectedItem()?.type === 'video'}>
        <button
          type="button"
          class="m-3 rounded border border-edge-muted p-2 text-xs hover:bg-hover"
          onClick={() => props.assets.togglePlayback(state.selection()[0]!)}
        >
          {props.assets.playing() === state.selection()[0]
            ? 'Pause video'
            : 'Play video'}
        </button>
      </Show>
      <Show when={selectedDocument()}>
        {(item) => (
          <>
            <button
              type="button"
              class="m-3 rounded border border-edge-muted p-2 text-xs hover:bg-hover"
              onClick={() => props.onOpenDocument(item().geometry)}
            >
              {item().geometry.entityType !== undefined &&
              item().geometry.entityType !== 'document'
                ? 'Open item'
                : 'Open document'}
            </button>
            <Show when={item().geometry.display === 'embed'}>
              <button
                type="button"
                class="mx-3 mb-3 rounded border border-edge-muted p-2 text-xs hover:bg-hover"
                onClick={() => {
                  state.embeds.exit();
                  editor.execute(setDocumentDisplayCommand, {
                    id: item().id,
                    display: 'preview',
                  });
                }}
              >
                Use preview card
              </button>
            </Show>
          </>
        )}
      </Show>
    </>
  );
}
