import {
  normalizePasteOrigin,
  PasteNode,
  type PasteNodeDecoratorProps,
} from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import type { DecoratorHostCapabilities } from '../context/DecoratorHostContext';
import {
  createNativeDecoratorAdapter,
  type NativeDecoratorContext,
} from './native-adapter';
import type { PasteNodeHost, PasteNodeHostProp } from './paste-node-host';

/** Project the native paste payload like Source PasteNode.exportComponentProps. */
export function createNativePasteNodeViews<
  Host extends DecoratorHostCapabilities & PasteNodeHost,
>(context: NativeDecoratorContext<Host>): Pick<MacroDecorators, 'paste'> {
  const bind = createNativeDecoratorAdapter(context);
  return {
    paste: bind<PasteNodeDecoratorProps & PasteNodeHostProp>(
      PasteNode,
      (node, context) => {
        const value = node.props();
        if (typeof value.content !== 'string')
          throw new Error('Invalid paste payload');
        return {
          content: value.content,
          origin: normalizePasteOrigin(value.origin),
          key: String(node.key),
          theme: context.theme,
          host: context.host,
        };
      }
    ),
  };
}
