import { normalizePasteOrigin, PasteNode } from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import type { PasteNodeUIProps } from '../component/decorator/PasteNode';
import type { DecoratorHostCapabilities } from '../context/DecoratorHostContext';
import {
  createNativeDecoratorAdapter,
  type NativeDecoratorContext,
} from './native-adapter';
import type { PasteNodeHost } from './paste-node-host';

/** Project the native paste payload like Source PasteNode.exportComponentProps. */
export function createNativePasteNodeViews<
  Host extends DecoratorHostCapabilities & PasteNodeHost,
>(context: NativeDecoratorContext<Host>): Pick<MacroDecorators, 'paste'> {
  const bind = createNativeDecoratorAdapter(context);
  return {
    paste: bind<PasteNodeUIProps>(PasteNode, (node, context) => {
      const { content, origin } = node.props();
      const stored = {
        key: String(node.key),
        theme: context.theme,
        host: context.host,
      };
      // A referenced chip parses its content as markdown, so only text renders.
      if (normalizePasteOrigin(origin) === 'referenced') {
        if (typeof content !== 'string')
          throw new Error('Invalid paste payload');
        return { ...stored, origin: 'referenced', content };
      }
      // A clipboard paste renders its content as text, null or omitted too.
      if (
        content !== undefined &&
        content !== null &&
        typeof content !== 'string'
      )
        throw new Error('Invalid paste payload');
      return { ...stored, origin: 'pasted', content };
    }),
  };
}
