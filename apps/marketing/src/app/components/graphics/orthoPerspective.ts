/** Parameters for an orthographic SVG face projection. */
export type OrthoPerspective = {
  heightScale: number;
  shearDegrees: number;
  rotationDegrees: number;
};

/** Where a flat mark should land on that projected face. */
export type OrthoPlacement = {
  scale: number;
  translateX: number;
  translateY: number;
};

/**
 * The projection used by the existing isometric module faces. Illustrator
 * applies vertical scale → shear → rotation; SVG's Y-down coordinates require
 * the design angles to be negated when producing the matrix.
 */
export const ORTHO_FACE_PERSPECTIVE: OrthoPerspective = {
  heightScale: 0.8101,
  shearDegrees: 21.79,
  rotationDegrees: 21.79,
};

const toSvgMatrixNumber = (value: number) => Number(value.toFixed(3));

/** Builds an SVG `matrix(a b c d e f)` for a flat mark on an ortho face. */
export const createOrthoPerspectiveTransform = (
  placement: OrthoPlacement,
  perspective: OrthoPerspective = ORTHO_FACE_PERSPECTIVE
) => {
  const rotation = (-perspective.rotationDegrees * Math.PI) / 180;
  const shear = Math.tan((-perspective.shearDegrees * Math.PI) / 180);
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const { heightScale } = perspective;
  const { scale, translateX, translateY } = placement;

  const xAxisX = scale * cosine;
  const xAxisY = scale * sine;
  const yAxisX = scale * heightScale * (cosine * shear - sine);
  const yAxisY = scale * heightScale * (sine * shear + cosine);

  return `matrix(${toSvgMatrixNumber(xAxisX)} ${toSvgMatrixNumber(xAxisY)} ${toSvgMatrixNumber(yAxisX)} ${toSvgMatrixNumber(yAxisY)} ${translateX} ${translateY})`;
};
