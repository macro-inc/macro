import { HtmlRenderNode } from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import type { HtmlRenderUIProps } from '../component/decorator/HtmlRender';
import type { DecoratorHostCapabilities } from '../context/DecoratorHostContext';
import {
  createNativeDecoratorAdapter,
  type NativeDecoratorContext,
} from './native-adapter';

/** Component projection only; literal Chrome mount-attribute parity remains a separate gate. */
export function createNativeFastHTMLDecoratorViews<
  Host extends DecoratorHostCapabilities,
>(context: NativeDecoratorContext<Host>): Pick<MacroDecorators, 'html-render'> {
  const bind = createNativeDecoratorAdapter(context);
  return {
    'html-render': bind<HtmlRenderUIProps>(HtmlRenderNode, (node, context) => {
      const { html, adaptColors } = node.props();
      // Source keeps a stored null hint and treats it like an omitted one.
      if (
        typeof html !== 'string' ||
        (adaptColors !== undefined &&
          adaptColors !== null &&
          typeof adaptColors !== 'boolean')
      )
        throw new Error('Invalid HTML render payload');
      return {
        html,
        adaptColors,
        key: String(node.key),
        theme: context.theme,
      };
    }),
  };
}
