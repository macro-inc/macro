import { $createImageNode, ImageNode } from '@macro-inc/lexical-core';
import {
  $getSelection,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  type LexicalCommand,
  type LexicalEditor,
} from 'lexical';
import { $insertNodesAndSplitList } from '../../utils';
import type { Gif } from './klipy';

const MAX_GIF_WIDTH = 400;

export const TRY_INSERT_GIF_COMMAND: LexicalCommand<void> = createCommand(
  'TRY_INSERT_GIF_COMMAND'
);

type GifPickerPluginProps = {
  onOpenPicker: () => void;
};

function registerGifPickerPlugin(
  editor: LexicalEditor,
  props: GifPickerPluginProps
) {
  return editor.registerCommand(
    TRY_INSERT_GIF_COMMAND,
    () => {
      const selection = $getSelection();
      if (!selection) {
        return false;
      }
      props.onOpenPicker();
      return true;
    },
    COMMAND_PRIORITY_NORMAL
  );
}

export function gifPickerPlugin(props: GifPickerPluginProps) {
  return (editor: LexicalEditor) => registerGifPickerPlugin(editor, props);
}

export function $insertGifNode(gif: Gif) {
  const width = Math.min(gif.width, MAX_GIF_WIDTH);
  const imageNode = $createImageNode({
    srcType: 'url',
    url: gif.url,
    alt: gif.title,
    width: gif.width,
    height: gif.height,
    constrainedWidth: width,
    constrainedHeight: Math.round((width / gif.width) * gif.height),
  });

  $insertNodesAndSplitList([imageNode]);
}

export { ImageNode as GifDependency };
