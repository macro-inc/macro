import { fireAndForget } from '@core/util/fireAndForget';
import type { ViewNode } from '@macro-inc/lexical-wasm-view/view/types';
import type { EditorThemeClasses } from 'lexical';
import { type Accessor, onCleanup } from 'solid-js';
import type { DecoratorHost } from '../context/DecoratorHostContext';
import {
  dispatchApplicationCommandIfSessionEdit,
  dispatchApplicationCommandSettled,
} from '../plugins/group-b/command';
import type { createNativeMediaUploadEvents } from '../plugins/media/native-upload-events';
import type {
  MediaDecoratorActions,
  MediaUploadCallbacks,
} from './media-actions';
import type { NativeDecoratorContext } from './native-adapter';
import { createNativeSelectionDecoratorContext } from './native-selection-host';

type NativeMediaHost = Pick<
  DecoratorHost,
  'isSelected' | 'isEditable' | 'isInteractable'
> & { media: MediaDecoratorActions };

export function createNativeMediaContext(
  kind: 'image' | 'video',
  theme: EditorThemeClasses,
  interactable: Accessor<boolean>,
  uploads: Pick<
    ReturnType<typeof createNativeMediaUploadEvents>,
    'pending' | 'subscribe'
  >
) {
  const selection = createNativeSelectionDecoratorContext(theme);
  let view: Parameters<NativeDecoratorContext['bindView']>[0] | undefined;
  return {
    ...selection,
    bindView(incoming: Parameters<NativeDecoratorContext['bindView']>[0]) {
      selection.bindView(incoming);
      view = incoming;
    },
    dispose() {
      view = undefined;
      selection.dispose();
    },
    mediaHost(snapshot: ViewNode): NativeMediaHost {
      const mounted = view;
      const generation = mounted?.mirror.keyGeneration;
      if (!mounted || generation == null)
        throw new Error('Media decorator requires an acknowledged view');
      const captured = snapshot.props();
      let live = true;
      let uploadCallbacks: MediaUploadCallbacks | undefined;
      onCleanup(() => {
        live = false;
        uploadCallbacks = undefined;
      });
      const current = () => {
        if (
          !live ||
          view !== mounted ||
          mounted.mirror.keyGeneration !== generation
        )
          return undefined;
        const node = mounted.node(snapshot.key);
        return node?.type === kind &&
          node.decoratorRevision === snapshot.decoratorRevision
          ? { view: mounted, node }
          : undefined;
      };
      const isEditable = () => current()?.view.root.contentEditable === 'true';
      const isSelected = (key: string) =>
        current() !== undefined && selection.host.isSelected(key);
      const localUrl = () => {
        const props = current()?.node.props();
        return props?.srcType === 'local' &&
          props.id === captured.id &&
          typeof props.url === 'string'
          ? props.url
          : undefined;
      };
      return {
        isEditable,
        isSelected,
        isInteractable: interactable,
        media: {
          select(key) {
            const target = current();
            if (target && isEditable() && !isSelected(key))
              target.view.port.selectionFromView({
                kind: 'node',
                keys: [target.node.key],
              });
          },
          remove() {
            const target = current();
            if (!target) return;
            fireAndForget(
              dispatchApplicationCommandSettled(target.view, 'group-b.media', {
                action: 'delete',
                key: target.node.key,
              }).then((result) => {
                if (result.status === 'error') throw result.error;
              }),
              'native-media-remove'
            );
          },
          resize(_key, width, height) {
            const target = current();
            if (target)
              dispatchApplicationCommandIfSessionEdit(
                target.view,
                'group-b.media-resize',
                { key: target.node.key, kind, width, height }
              );
          },
          persistScale(_key, scale) {
            const target = current();
            if (target && interactable() && isEditable())
              dispatchApplicationCommandIfSessionEdit(
                target.view,
                'group-b.media-set-property',
                {
                  key: target.node.key,
                  kind,
                  property: 'scale',
                  value: scale,
                  rerender: false,
                }
              );
          },
          readScale(_key, fallback) {
            const scale = current()?.node.props().scale;
            return typeof scale === 'number' ? scale : fallback;
          },
          upgradeUrl(_key, url) {
            const target = current();
            const props = target?.node.props();
            if (
              target &&
              props?.srcType === 'dss' &&
              typeof captured.id === 'string' &&
              (captured.url == null || typeof captured.url === 'string') &&
              props.id === captured.id &&
              props.url === captured.url
            )
              // Source sets the resolved url over a stored null or omitted
              // one too; the guard carries the captured url as stored.
              dispatchApplicationCommandIfSessionEdit(
                target.view,
                'group-b.media-upgrade-url',
                {
                  key: target.node.key,
                  kind,
                  source_id: captured.id,
                  ...(captured.url === undefined
                    ? {}
                    : { expected_url: captured.url }),
                  url,
                }
              );
          },
          subscribeUploads(_key, callbacks) {
            uploadCallbacks = callbacks;
            const url = localUrl();
            const release =
              url === undefined
                ? undefined
                : uploads.subscribe(kind, generation, url, {
                    start: () => {
                      if (localUrl() === url) callbacks.start();
                    },
                    success: (result) => {
                      const props = current()?.node.props();
                      if (
                        props?.srcType === 'sfs' &&
                        props.id === result.id &&
                        props.url === result.url
                      )
                        callbacks.success();
                    },
                    failure: () => {
                      if (localUrl() === url) callbacks.failure();
                    },
                    cancelled: () => {
                      if (localUrl() === url) callbacks.cancelled?.();
                    },
                  });
            return () => {
              uploadCallbacks = undefined;
              release?.();
            };
          },
          mounted() {
            const url = localUrl();
            if (url !== undefined && uploads.pending(kind, generation, url)) {
              uploadCallbacks?.start();
            } else if (current()?.node.props().srcType === 'sfs') {
              setTimeout(() => {
                if (current()) uploadCallbacks?.success();
              });
            }
          },
        },
      };
    },
  };
}
