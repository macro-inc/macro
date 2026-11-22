import { ImageNode } from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view';
import type { MarkdownImageProps } from '../component/decorator/MarkdownImage';
import { createNativeDecoratorAdapter } from './native-adapter';
import type { createNativeImageContext } from './native-image-host';

export function createNativeImageDecoratorViews(
  context: ReturnType<typeof createNativeImageContext>
): Pick<MacroDecorators, 'image'> {
  const bind = createNativeDecoratorAdapter(context);
  return {
    image: bind<MarkdownImageProps>(ImageNode, (node) => {
      const {
        srcType,
        id,
        url,
        alt,
        width,
        height,
        scale,
        constrainedWidth,
        constrainedHeight,
      } = node.props();
      if (
        (srcType != null && typeof srcType !== 'string') ||
        (id != null && typeof id !== 'string') ||
        typeof url !== 'string' ||
        typeof alt !== 'string' ||
        (width != null && typeof width !== 'number') ||
        (height != null && typeof height !== 'number') ||
        typeof scale !== 'number' ||
        (constrainedWidth != null && typeof constrainedWidth !== 'number') ||
        (constrainedHeight != null && typeof constrainedHeight !== 'number')
      )
        throw new Error('Invalid native image decorator payload');
      return {
        key: String(node.key),
        srcType,
        id,
        url,
        alt,
        width,
        height,
        scale,
        constrainedWidth,
        constrainedHeight,
        host: context.imageHost(node),
      };
    }),
  };
}
