import { useContext } from 'solid-js';
import {
  type DecoratorHost,
  DecoratorHostContext,
  type DecoratorUploadCallbacks,
} from '../context/DecoratorHostContext';
import { LexicalWrapperContext } from '../context/LexicalWrapperContext';
import { createLexicalDecoratorHost } from './lexical';

export type ImageUploadCallbacks = DecoratorUploadCallbacks & {
  cancelled?(): void;
};

export type ImageHost = Pick<
  DecoratorHost,
  'isSelected' | 'isEditable' | 'isInteractable'
> & {
  image: Omit<DecoratorHost['image'], 'subscribeUploads'> & {
    subscribeUploads(key: string, callbacks: ImageUploadCallbacks): () => void;
  };
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
