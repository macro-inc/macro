import { useContext } from 'solid-js';
import {
  type DecoratorHost,
  DecoratorHostContext,
} from '../context/DecoratorHostContext';
import { LexicalWrapperContext } from '../context/LexicalWrapperContext';
import { createLexicalDecoratorHost } from './lexical';

import type { MediaDecoratorActions } from './media-actions';

export type ImageHost = Pick<
  DecoratorHost,
  'isSelected' | 'isEditable' | 'isInteractable'
> & {
  image: MediaDecoratorActions;
};

export function useImageHost(supplied?: ImageHost): ImageHost {
  if (supplied) return supplied;
  const host = useContext(DecoratorHostContext);
  const wrapper = useContext(LexicalWrapperContext);
  if (!host) return createLexicalDecoratorHost(wrapper);
  const { isSelected, isEditable, isInteractable, image } = host;
  if (!isSelected || !isEditable || !isInteractable || !image)
    throw new Error('Image requires selection, access and media capabilities');
  return { isSelected, isEditable, isInteractable, image };
}
