import { EdgeEndStyles } from '@block-canvas/model/CanvasModel';
import { Match, Switch } from 'solid-js';

export type ArrowStyle = {
  stroke: string | undefined;
  'stroke-width': string | number | undefined;
};

export interface ArrowProps {
  x: number;
  y: number;
  angle: number;
  style: ArrowStyle;
  arrowLength: number;
  onPointerDown?: (e: PointerEvent) => void;
}

export interface ArrowHeadProps {
  arrowStyle: number | undefined;
  x: number;
  y: number;
  angle: number;
  length: number;
  style: ArrowStyle;
  end: 'from' | 'to';
  onPointerDown?: (e: PointerEvent) => void;
}

export const ArrowLines = (props: ArrowProps) => {
  return (
    <>
      <line
        x1={props.x}
        y1={props.y}
        x2={props.x + props.arrowLength * Math.cos(props.angle - Math.PI / 4)}
        y2={props.y + props.arrowLength * Math.sin(props.angle - Math.PI / 4)}
        stroke={props.style.stroke}
        stroke-width={props.style['stroke-width']}
        stroke-linecap="round"
        stroke-linejoin="round"
        on:pointerdown={props.onPointerDown}
      />
      <line
        x1={props.x}
        y1={props.y}
        x2={props.x + props.arrowLength * Math.cos(props.angle + Math.PI / 4)}
        y2={props.y + props.arrowLength * Math.sin(props.angle + Math.PI / 4)}
        stroke={props.style.stroke}
        stroke-width={props.style['stroke-width']}
        stroke-linecap="round"
        stroke-linejoin="round"
        on:pointerdown={props.onPointerDown}
      />
    </>
  );
};

export const ArrowSolid = (props: ArrowProps) => {
  return (
    <polygon
      points={`${props.x},${props.y} 
              ${props.x + props.arrowLength * Math.cos(props.angle - Math.PI / 6)},
              ${props.y + props.arrowLength * Math.sin(props.angle - Math.PI / 6)} 
              ${props.x + props.arrowLength * Math.cos(props.angle + Math.PI / 6)},
              ${props.y + props.arrowLength * Math.sin(props.angle + Math.PI / 6)}`}
      fill={props.style.stroke}
      stroke-width={props.style['stroke-width']}
      stroke={props.style.stroke}
      on:pointerdown={props.onPointerDown}
    />
  );
};

export const ArrowCircle = (props: Omit<ArrowProps, 'angle'>) => {
  return (
    <circle
      cx={props.x}
      cy={props.y}
      r={props.arrowLength / 2}
      fill={props.style.stroke}
      on:pointerdown={props.onPointerDown}
    />
  );
};

export const ArrowCircleSmall = (props: Omit<ArrowProps, 'angle'>) => {
  return (
    <circle
      cx={props.x}
      cy={props.y}
      r={props.arrowLength / 4}
      fill={props.style.stroke}
      on:pointerdown={props.onPointerDown}
    />
  );
};

export const ArrowHead = (props: ArrowHeadProps) => {
  return (
    <Switch>
      <Match when={props.arrowStyle === EdgeEndStyles.Arrow}>
        <ArrowLines
          x={props.x}
          y={props.y}
          angle={props.angle}
          style={props.style}
          arrowLength={props.length}
        />
      </Match>
      <Match when={props.arrowStyle === EdgeEndStyles.ArrowFilled}>
        <ArrowSolid
          x={props.x}
          y={props.y}
          angle={props.angle}
          style={props.style}
          arrowLength={props.length}
        />
      </Match>
      <Match when={props.arrowStyle === EdgeEndStyles.Circle}>
        <ArrowCircle
          x={props.x}
          y={props.y}
          style={props.style}
          arrowLength={props.length}
        />
      </Match>
      <Match when={props.arrowStyle === EdgeEndStyles.CircleSmall}>
        <ArrowCircleSmall
          x={props.x}
          y={props.y}
          style={props.style}
          arrowLength={props.length}
        />
      </Match>
    </Switch>
  );
};
