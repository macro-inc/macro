import { ENABLE_CANVAS_VIDEO } from '@core/constant/featureFlags';
import { Match, Switch } from 'solid-js';
import type { RenderMode } from '../constants';
import {
  type CanvasEdge,
  type CanvasNode,
  type FileNode,
  type ImageNode,
  isFileNode,
  isImageNode,
  isPencilNode,
  isShapeNode,
  isTextNode,
  isVideoNode,
  type PencilNode,
  type ShapeNode,
  type TextNode,
  type VideoNode,
} from '../model/CanvasModel';
import { Line } from './edges/Line';
import { File } from './nodes/DSSFile';
import { DSSMedia } from './nodes/DSSMedia';
import { Pencil } from './nodes/Pencil';
import { Shape } from './nodes/Shape';
import { TextBox } from './nodes/TextBox';

export function NodeRenderer(props: { node: CanvasNode; mode: RenderMode }) {
  return (
    <Switch>
      <Match when={isShapeNode(props.node)}>
        <Shape node={props.node as ShapeNode} mode={props.mode} />
      </Match>
      <Match when={isPencilNode(props.node)}>
        <Pencil node={props.node as PencilNode} mode={props.mode} />
      </Match>
      <Match
        when={
          isImageNode(props.node) ||
          (ENABLE_CANVAS_VIDEO && isVideoNode(props.node))
        }
      >
        <DSSMedia
          node={props.node as ImageNode | VideoNode}
          mode={props.mode}
        />
      </Match>
      <Match when={isTextNode(props.node)}>
        <TextBox node={props.node as TextNode} mode={props.mode} />
      </Match>
      <Match when={isFileNode(props.node)}>
        <File node={props.node as FileNode} mode={props.mode} />
      </Match>
    </Switch>
  );
}

export function EdgeRenderer(props: { edge: CanvasEdge; mode: RenderMode }) {
  return <Line edge={props.edge} mode={props.mode} />;
}
