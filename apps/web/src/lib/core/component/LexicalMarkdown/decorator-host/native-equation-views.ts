import {
  type EquationDecoratorProps,
  EquationNode,
} from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view';
import type { EquationHost } from './equation-host';
import {
  createNativeDecoratorAdapter,
  type NativeDecoratorContext,
} from './native-adapter';

export function createNativeEquationViews(
  context: NativeDecoratorContext<EquationHost>
): Pick<MacroDecorators, 'equation'> {
  const bind = createNativeDecoratorAdapter(context);
  return {
    equation: bind<EquationDecoratorProps>(EquationNode, (node) => {
      const data = node.props();
      if (typeof data.equation !== 'string' || typeof data.inline !== 'boolean')
        throw new Error('Invalid native equation props');
      return {
        key: String(node.key),
        equation: data.equation,
        inline: data.inline,
      };
    }),
  };
}
