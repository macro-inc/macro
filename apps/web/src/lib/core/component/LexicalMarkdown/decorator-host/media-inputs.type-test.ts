import type {
  EquationDecoratorProps,
  ImageDecoratorProps,
  VideoDecoratorProps,
} from '@macro-inc/lexical-core';
import type { MarkdownImageProps } from '../component/decorator/MarkdownImage';
import type { MarkdownVideoProps } from '../component/decorator/MarkdownVideo';

type Assert<T extends true> = T;

export type ImageUiKeepsNullSourceType = Assert<
  null extends MarkdownImageProps['srcType'] ? true : false
>;
export type ImageUiKeepsNullId = Assert<
  null extends MarkdownImageProps['id'] ? true : false
>;
export type ImageUiKeepsNullWidth = Assert<
  null extends MarkdownImageProps['width'] ? true : false
>;
export type ImageUiKeepsNullHeight = Assert<
  null extends MarkdownImageProps['height'] ? true : false
>;
export type ImageUiKeepsNullConstraint = Assert<
  null extends MarkdownImageProps['constrainedWidth'] ? true : false
>;
// Retained boundary, not a Source behaviour.
export type ImageUiUrlRemainsText = Assert<
  MarkdownImageProps['url'] extends string ? true : false
>;
export type ImageUiAltRemainsText = Assert<
  MarkdownImageProps['alt'] extends string ? true : false
>;
export type ImageUiScaleRemainsNumber = Assert<
  MarkdownImageProps['scale'] extends number ? true : false
>;

export type VideoUiKeepsNullSourceType = Assert<
  null extends MarkdownVideoProps['srcType'] ? true : false
>;
export type VideoUiKeepsNullId = Assert<
  null extends MarkdownVideoProps['id'] ? true : false
>;
export type VideoUiKeepsNullWidth = Assert<
  null extends MarkdownVideoProps['width'] ? true : false
>;
export type VideoUiKeepsNullHeight = Assert<
  null extends MarkdownVideoProps['height'] ? true : false
>;
export type VideoUiKeepsNullUrl = Assert<
  null extends MarkdownVideoProps['url'] ? true : false
>;
export type VideoUiKeepsMissingUrl = Assert<
  undefined extends MarkdownVideoProps['url'] ? true : false
>;
export type PublicVideoUrlRemainsText = Assert<
  null extends VideoDecoratorProps['url'] ? false : true
>;
export type VideoUiControlsRemainFlag = Assert<
  MarkdownVideoProps['controls'] extends boolean ? true : false
>;

export type EquationTextRemainsText = Assert<
  null extends EquationDecoratorProps['equation'] ? false : true
>;
export type PublicImageIdRemainsExact = Assert<
  null extends ImageDecoratorProps['id'] ? false : true
>;
export type PublicImageWidthRemainsExact = Assert<
  null extends ImageDecoratorProps['width'] ? false : true
>;
export type PublicVideoSourceTypeRemainsExact = Assert<
  null extends VideoDecoratorProps['srcType'] ? false : true
>;
export type SourceImageInfoStillFitsUiProps = Assert<
  ImageDecoratorProps extends MarkdownImageProps ? true : false
>;
export type SourceVideoInfoStillFitsUiProps = Assert<
  VideoDecoratorProps extends MarkdownVideoProps ? true : false
>;
