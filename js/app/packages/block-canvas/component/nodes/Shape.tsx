import { useToolManager } from '@block-canvas/signal/toolManager';
import { useUpdateNode } from '@block-canvas/store/canvasData';
import { useCanEdit } from '@core/signal/permissions';
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  Match,
  onCleanup,
  onMount,
  type Setter,
  Show,
  Switch,
} from 'solid-js';
import { type RenderMode, RenderModes } from '../../constants';
import type { ShapeNode, ShapeType } from '../../model/CanvasModel';
import type { Color } from '../../util/color';
import { getBorderRadius, getTailwindColor, opacity } from '../../util/style';
import { BaseCanvasRectangle } from './BaseCanvasRectangle';

const selectEnd = (target: HTMLElement) => {
  const range = document.createRange();
  const selection = window.getSelection();
  range.setStart(target, target.childNodes.length);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
};

function Label(props: {
  node: ShapeNode;
  setRef: Setter<HTMLSpanElement | undefined>;
  onFocus?: (value: string) => void;
  onBlur?: (value: string) => void;
}) {
  const canEdit = useCanEdit();
  const toolManager = useToolManager();
  let labelRef!: HTMLSpanElement;
  const [hasFocus, setHasFocus] = createSignal(false);

  const labelStyle = createMemo((): Partial<JSX.CSSProperties> => {
    const color = props.node.style?.strokeColor ?? getTailwindColor('gray-700');
    return {
      color: color,
      'font-size': `${props.node.style?.textSize ?? 12}px`,
      'caret-color': color,
    };
  });

  createEffect(() => {
    if (!hasFocus() && labelRef.textContent !== props.node.label) {
      labelRef.textContent = props.node.label || '';
    }
  });

  onMount(() => {
    props.setRef(labelRef);
    toolManager.ignoreMouseEvents(labelRef);
  });

  onCleanup(() => {
    toolManager.removeIgnoreMouseEvents(labelRef);
  });

  const handleFocus = () => {
    props.onFocus?.(labelRef.textContent || '');
    toolManager.setActiveTextEditor(true);
    setHasFocus(true);
  };
  const handleBlur = () => {
    props.onBlur?.(labelRef.textContent || '');
    getSelection()?.empty();
    labelRef.textContent = '';
    toolManager.setActiveTextEditor(false);
    setHasFocus(false);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      labelRef.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      labelRef.blur();
    }
  };

  return (
    <div
      class="absolute top-0 left-0 w-full h-full flex items-center justify-center overflow-clip"
      classList={{
        'user-select-none': !hasFocus(),
        'pointer-events-auto': hasFocus(),
      }}
    >
      <span
        ref={labelRef}
        class="text-center font-semibold word-break-break-all min-w-0 max-w-[calc(100%-2rem)]"
        style={labelStyle()}
        contentEditable={canEdit()}
        on:focus={handleFocus}
        on:blur={handleBlur}
        on:keydown={handleKeyDown}
      ></span>
    </div>
  );
}

function RectanglePrimitive(props: { style: Partial<JSX.CSSProperties> }) {
  return <div style={props.style} />;
}

function EllipsePrimitive(props: { style: any; node: ShapeNode }) {
  return (
    <svg width={props.node.width} height={props.node.height}>
      <ellipse style={props.style} />
    </svg>
  );
}

function RenderPrimitive(props: {
  shapeType: ShapeType;
  shapeStyle: Partial<JSX.CSSProperties>;
  node: ShapeNode;
}) {
  return (
    <Switch>
      <Match when={props.shapeType === 'rectangle'}>
        <RectanglePrimitive style={props.shapeStyle} />
      </Match>
      <Match when={props.shapeType === 'ellipse'}>
        <EllipsePrimitive style={props.shapeStyle} node={props.node} />
      </Match>
    </Switch>
  );
}

export function Shape(props: { node: ShapeNode; mode: RenderMode }) {
  const updateNode = useUpdateNode();
  const [labelRef, setLabelRef] = createSignal<HTMLSpanElement>();
  const [labelHasFocus, setLabelHasFocus] = createSignal(false);

  const strokeWidth = props.node.style?.strokeWidth || 0;
  const borderRadiusWidthPct = (strokeWidth / props.node.width) * 100;
  const borderRadiusHeightPct = (strokeWidth / props.node.height) * 100;

  const shapeStyle = createMemo((): any => {
    const fillHex = props.node.style?.fillColor ?? getTailwindColor('gray-200');
    const fillHexWithOpacity = opacity(
      fillHex as Color,
      props.mode === RenderModes.Preview ? 20 : 80
    );
    let borderHex =
      props.node.style?.strokeColor ?? getTailwindColor('gray-700');

    return {
      fill: fillHexWithOpacity,
      stroke: borderHex,
      'stroke-width': props.node.style?.strokeWidth,
      'background-color': fillHexWithOpacity,
      'border-color': borderHex,
      'border-width': `${props.node.style?.strokeWidth ?? 2}px`,
      'border-style': 'solid',
      'border-radius': `${getBorderRadius(props.node)}`,
      'box-sizing': 'border-box',
      width: '100%',
      height: '100%',
      cx: '50%',
      cy: '50%',
      rx: `${50 - borderRadiusWidthPct}%`,
      ry: `${50 - borderRadiusHeightPct}%`,
    };
  });

  const handleDblClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (!props.node.label) {
      updateNode(props.node.id, {
        label: '',
      });
    }
    const ref = labelRef();
    if (ref) {
      ref.focus();
      selectEnd(ref);
    }
  };

  return (
    <BaseCanvasRectangle
      node={props.node}
      mode={props.mode}
      clickable={!labelHasFocus()}
      useSimpleSelectionBox={false}
    >
      <div
        class="w-full h-full"
        classList={{
          'pointer-events-auto': !labelHasFocus(),
        }}
        on:dblclick={handleDblClick}
      >
        <RenderPrimitive
          shapeType={props.node.shape}
          shapeStyle={shapeStyle()}
          node={props.node}
        />
      </div>
      <Show when={props.node.label !== undefined}>
        <Label
          node={props.node}
          setRef={setLabelRef}
          onFocus={() => {
            setLabelHasFocus(true);
          }}
          onBlur={(str) => {
            updateNode(props.node.id, {
              label: str,
            });
            setLabelHasFocus(false);
          }}
        />
      </Show>
    </BaseCanvasRectangle>
  );
}
