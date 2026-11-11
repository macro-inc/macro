import { getDecorator } from '@macro-inc/lexical-core/decoratorRegistry';
import type { DecoratorProps } from '@macro-inc/lexical-wasm-view';
import type { ViewNode } from '@macro-inc/lexical-wasm-view/view/types';
import type { EditorThemeClasses, Klass, LexicalNode } from 'lexical';
import {
  type Accessor,
  type Component,
  createComponent,
  createMemo,
  type MergeProps,
  mergeProps,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  type DecoratorHostCapabilities,
  DecoratorHostContext,
} from '../context/DecoratorHostContext';

export interface NativeDecoratorContext<
  Host extends DecoratorHostCapabilities = DecoratorHostCapabilities,
> {
  readonly host: Host;
  readonly theme: EditorThemeClasses;
  bindView(view: DecoratorProps['view']): void;
}

/** Mount actual registered components over typed native props, without creating JS model nodes. */
export function createNativeDecoratorAdapter<
  Host extends DecoratorHostCapabilities,
>(context: NativeDecoratorContext<Host>) {
  return function bind<Props extends {}>(
    klass: Klass<LexicalNode>,
    project: (node: ViewNode, context: NativeDecoratorContext<Host>) => Props
  ): Component<DecoratorProps> {
    const component = getDecorator<MergeProps<[Accessor<Props>]>>(klass);
    if (!component)
      throw new Error(
        `Missing initialized decorator component: ${klass.getType()}`
      );
    return (props) => {
      context.bindView(props.view);
      const current = createMemo(() => project(props.node(), context));
      // Source decorate() publishes a new component closure for an uncached
      // node update. Revision-bearing nodes retain their captured view snapshot
      // in EditorView, so they do not reach this projection until remount.
      const render = createMemo(() => {
        const captured = current();
        return () =>
          createComponent(
            component,
            mergeProps(() => captured)
          );
      });
      return createComponent(DecoratorHostContext.Provider, {
        value: context.host,
        get children() {
          return createComponent(Dynamic, {
            get component() {
              return render();
            },
          });
        },
      });
    };
  };
}
