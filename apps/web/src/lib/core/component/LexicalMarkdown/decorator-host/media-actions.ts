import type {
  DecoratorHost,
  DecoratorUploadCallbacks,
} from '../context/DecoratorHostContext';

export type MediaUploadCallbacks = DecoratorUploadCallbacks & {
  cancelled?(): void;
};

export type MediaDecoratorActions = Omit<
  DecoratorHost['image'],
  'subscribeUploads'
> & {
  subscribeUploads(key: string, callbacks: MediaUploadCallbacks): () => void;
};
