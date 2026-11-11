import { fireAndForget } from '@core/util/fireAndForget';
import type { ViewNode } from '@macro-inc/lexical-wasm-view/view/types';
import type { EditorThemeClasses } from 'lexical';
import { type Accessor, onCleanup } from 'solid-js';
import type { DecoratorUploadCallbacks } from '../context/DecoratorHostContext';
import {
  dispatchApplicationCommandIfSessionEdit,
  dispatchApplicationCommandSettled,
} from '../plugins/group-b/command';
import type { createNativeMediaUploadEvents } from '../plugins/media/native-upload-events';
import type { ImageHost } from './image-host';
import type { NativeDecoratorContext } from './native-adapter';
import { createNativeSelectionDecoratorContext } from './native-selection-host';

export function createNativeImageContext(
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
    imageHost(snapshot: ViewNode): ImageHost {
      const mounted = view;
      const generation = mounted?.mirror.keyGeneration;
      const captured = snapshot.props();
      let live = true;
      let uploadCallbacks: DecoratorUploadCallbacks | undefined;
      onCleanup(() => {
        live = false;
        uploadCallbacks = undefined;
      });
      const current = () => {
        if (
          !live ||
          !mounted ||
          view !== mounted ||
          generation === null ||
          mounted.mirror.keyGeneration !== generation
        )
          return undefined;
        const node = mounted.node(snapshot.key);
        return node?.type === 'image' &&
          node.decoratorRevision === snapshot.decoratorRevision
          ? { view: mounted, node }
          : undefined;
      };
      const isEditable = () => current()?.view.root.contentEditable === 'true';
      const isSelected = (key: string) =>
        current() !== undefined && selection.host.isSelected(key);
      const localUrl = () => {
        const props = current()?.node.props();
        return props?.srcType === 'local' && typeof props.url === 'string'
          ? props.url
          : undefined;
      };
      return {
        isEditable,
        isSelected,
        isInteractable: interactable,
        image: {
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
              'native-image-remove'
            );
          },
          resize(_key, width, height) {
            const target = current();
            if (target)
              dispatchApplicationCommandIfSessionEdit(
                target.view,
                'group-b.media-resize',
                { key: target.node.key, kind: 'image', width, height }
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
                  kind: 'image',
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
              typeof captured.url === 'string' &&
              props.id === captured.id &&
              props.url === captured.url
            )
              dispatchApplicationCommandIfSessionEdit(
                target.view,
                'group-b.media-upgrade-url',
                {
                  key: target.node.key,
                  kind: 'image',
                  source_id: captured.id,
                  expected_url: captured.url,
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
                : uploads.subscribe(url, {
                    start: () => {
                      if (current()) callbacks.start();
                    },
                    success: () => {
                      if (current()) callbacks.success();
                    },
                    failure: () => {
                      if (current()) callbacks.failure();
                    },
                  });
            return () => {
              uploadCallbacks = undefined;
              release?.();
            };
          },
          mounted() {
            const url = localUrl();
            if (url !== undefined && uploads.pending(url)) {
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
