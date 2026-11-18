import type { ViewNode } from '@macro-inc/lexical-wasm-view/view/types';
import type { EditorThemeClasses } from 'lexical';
import type { Accessor } from 'solid-js';
import type { ImageHost } from './image-host';
import { createNativeMediaContext } from './native-media-host';

export function createNativeImageContext(
  theme: EditorThemeClasses,
  interactable: Accessor<boolean>,
  uploads: Parameters<typeof createNativeMediaContext>[3]
) {
  const { mediaHost, ...context } = createNativeMediaContext(
    'image',
    theme,
    interactable,
    uploads
  );
  return {
    ...context,
    imageHost(node: ViewNode): ImageHost {
      const { media, ...host } = mediaHost(node);
      return { ...host, image: media };
    },
  };
}
