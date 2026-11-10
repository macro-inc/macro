import {
  type HtmlRenderDecoratorProps,
  HtmlRenderNode,
} from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
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
    'html-render': bind<HtmlRenderDecoratorProps>(
      HtmlRenderNode,
      (node, context) => {
        const value = node.props();
        if (
          typeof value.html !== 'string' ||
          (value.adaptColors !== undefined &&
            typeof value.adaptColors !== 'boolean')
        )
          throw new Error('Invalid HTML render payload');
        return {
          html: value.html,
          adaptColors: value.adaptColors,
          key: String(node.key),
          theme: context.theme,
        };
      }
    ),
  };
}
