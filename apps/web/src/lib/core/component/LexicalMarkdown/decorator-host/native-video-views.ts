import { VideoNode } from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view';
import type { EditorThemeClasses } from 'lexical';
import type { Accessor } from 'solid-js';
import type { MarkdownVideoProps } from '../component/decorator/MarkdownVideo';
import { createNativeDecoratorAdapter } from './native-adapter';
import { createNativeMediaContext } from './native-media-host';

export function createNativeVideoContext(
  theme: EditorThemeClasses,
  interactable: Accessor<boolean>,
  uploads: Parameters<typeof createNativeMediaContext>[3]
) {
  return createNativeMediaContext('video', theme, interactable, uploads);
}

export function createNativeVideoDecoratorViews(
  context: ReturnType<typeof createNativeVideoContext>
): Pick<MacroDecorators, 'video'> {
  const bind = createNativeDecoratorAdapter(context);
  return {
    video: bind<MarkdownVideoProps>(VideoNode, (node) => {
      const {
        srcType,
        id,
        url,
        controls,
        width,
        height,
        scale,
        constrainedWidth,
        constrainedHeight,
      } = node.props();
      if (
        (srcType != null && typeof srcType !== 'string') ||
        (id != null && typeof id !== 'string') ||
        (url != null && typeof url !== 'string') ||
        typeof controls !== 'boolean' ||
        (width != null && typeof width !== 'number') ||
        (height != null && typeof height !== 'number') ||
        typeof scale !== 'number' ||
        (constrainedWidth != null && typeof constrainedWidth !== 'number') ||
        (constrainedHeight != null && typeof constrainedHeight !== 'number')
      )
        throw new Error('Invalid native video decorator payload');
      const { media, ...host } = context.mediaHost(node);
      return {
        key: String(node.key),
        srcType,
        id,
        url,
        controls,
        width,
        height,
        scale,
        constrainedWidth,
        constrainedHeight,
        host: {
          ...host,
          video: {
            ...media,
            mounted(key) {
              setTimeout(() => media.mounted(key), 10);
            },
          },
        },
      };
    }),
  };
}
