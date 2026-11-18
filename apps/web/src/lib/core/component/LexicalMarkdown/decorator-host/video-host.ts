import { mergeRegister } from '@lexical/utils';
import { $isVideoNode } from '@macro-inc/lexical-core';
import {
  $createNodeSelection,
  $getNodeByKey,
  $setSelection,
  COMMAND_PRIORITY_LOW,
} from 'lexical';
import { useContext } from 'solid-js';
import type { DecoratorHost } from '../context/DecoratorHostContext';
import { LexicalWrapperContext } from '../context/LexicalWrapperContext';
import {
  $upgradeDSSMediaUrl,
  ON_MEDIA_COMPONENT_MOUNT_COMMAND,
  UPDATE_MEDIA_SIZE_COMMAND,
  UPLOAD_MEDIA_FAILURE_COMMAND,
  UPLOAD_MEDIA_START_COMMAND,
  UPLOAD_MEDIA_SUCCESS_COMMAND,
} from '../plugins/media';
import { removeNodeAndRestoreSelection } from '../plugins/shared/removeNodeAndRestoreSelection';
import type { MediaDecoratorActions } from './media-actions';

export type VideoHost = Pick<
  DecoratorHost,
  'isSelected' | 'isEditable' | 'isInteractable'
> & { video: MediaDecoratorActions };

export function useVideoHost(supplied?: VideoHost): VideoHost {
  if (supplied) return supplied;
  const wrapper = useContext(LexicalWrapperContext);
  const editor = () => wrapper?.editor;
  const isSelected = (key: string) => {
    const selection = wrapper?.selection;
    return selection?.type === 'node' && selection.nodeKeys.has(key);
  };
  const isEditable = () => editor()?.isEditable() ?? false;
  const isInteractable = () => wrapper?.isInteractable() ?? false;
  return {
    isSelected,
    isEditable,
    isInteractable,
    video: {
      select(key) {
        const current = editor();
        if (!current || !current.isEditable() || isSelected(key)) return;
        current.update(() => {
          const selection = $createNodeSelection();
          selection.add(key);
          $setSelection(selection);
        });
      },
      remove(key) {
        const current = editor();
        if (current) removeNodeAndRestoreSelection(current, key, $isVideoNode);
      },
      resize(key, width, height) {
        editor()?.dispatchCommand(UPDATE_MEDIA_SIZE_COMMAND, [
          key,
          { width, height },
          'video',
        ]);
      },
      persistScale(key, scale) {
        const current = editor();
        if (!isInteractable() || !current?.isEditable()) return;
        current.update(() => {
          if (!current.isEditable()) return;
          const node = $getNodeByKey(key);
          if (node && $isVideoNode(node)) node.setScale(scale, false);
        });
      },
      readScale(key, fallback) {
        return editor()?.read(() => {
          const node = $getNodeByKey(key);
          return node && $isVideoNode(node) ? node.getScale() : fallback;
        });
      },
      upgradeUrl(key, url) {
        editor()?.update(() => $upgradeDSSMediaUrl(key, url, 'video'), {
          discrete: true,
          tag: 'historic',
        });
      },
      subscribeUploads(key, callbacks) {
        const current = editor();
        if (!current) return () => {};
        return mergeRegister(
          current.registerCommand(
            UPLOAD_MEDIA_START_COMMAND,
            ([target]) => {
              if (target !== key) return false;
              callbacks.start();
              return true;
            },
            COMMAND_PRIORITY_LOW
          ),
          current.registerCommand(
            UPLOAD_MEDIA_SUCCESS_COMMAND,
            ([target]) => {
              if (target !== key) return false;
              callbacks.success();
              return true;
            },
            COMMAND_PRIORITY_LOW
          ),
          current.registerCommand(
            UPLOAD_MEDIA_FAILURE_COMMAND,
            ([target]) => {
              if (target !== key) return false;
              callbacks.failure();
              return true;
            },
            COMMAND_PRIORITY_LOW
          )
        );
      },
      mounted(key) {
        const current = editor();
        if (current)
          setTimeout(() => {
            current.dispatchCommand(ON_MEDIA_COMPONENT_MOUNT_COMMAND, [
              key,
              'video',
            ]);
          }, 10);
      },
    },
  };
}
