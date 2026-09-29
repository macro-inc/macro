export interface ArcParams {
  x1: number;
  y1: number;
  rx: number;
  ry: number;
  phi: number;
  largeArc: boolean;
  sweep: boolean;
  x2: number;
  y2: number;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface PathCommand {
  type: 'M' | 'L' | 'C' | 'Z';
  points: Point3D[];
}

export interface PathData {
  commands: PathCommand[];
  packedPoints: Float32Array;
  attributes: Record<string, string>;
}

export interface Transform3D {
  rx: number;
  ry: number;
  rz: number;
  tx: number;
  ty: number;
  tz: number;
  sx: number;
  sy: number;
  sz: number;
  cx: number;
  cy: number;
  cz: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ViewBox {
  height: number;
  width: number;
  minX: number;
  minY: number;
}

export type Mat4 = Float32Array;

export type OrbitAxis = 'x' | 'y' | 'z';
