import {
  type DiffInsertDecoratorProps,
  DiffInsertNode,
} from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view';
import type { DiffInsertHost } from './diff-insert-host';
import {
  createNativeDecoratorAdapter,
  type NativeDecoratorContext,
} from './native-adapter';

export function createNativeDiffInsertViews(
  context: NativeDecoratorContext<DiffInsertHost>
): Pick<MacroDecorators, 'diff-insert'> {
  const bind = createNativeDecoratorAdapter(context);
  return {
    'diff-insert': bind<DiffInsertDecoratorProps>(
      DiffInsertNode,
      (node, { theme }) => {
        const markdown = node.props().markdown;
        if (typeof markdown !== 'string')
          throw new Error('Invalid native diff-insert markdown');
        return { key: String(node.key), markdown, theme };
      }
    ),
  };
}
