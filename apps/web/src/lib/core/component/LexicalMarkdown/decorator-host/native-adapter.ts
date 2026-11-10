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
import {
  type DecoratorHost,
  DecoratorHostContext,
} from '../context/DecoratorHostContext';

export interface NativeDecoratorContext<
  Host extends DecoratorHost = DecoratorHost,
> {
  readonly host: Host;
  readonly theme: EditorThemeClasses;
  bindView(view: DecoratorProps['view']): void;
}

/** Mount actual registered components over typed native props, without creating JS model nodes. */
export function createNativeDecoratorAdapter<Host extends DecoratorHost>(
  context: NativeDecoratorContext<Host>
) {
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
      return createComponent(DecoratorHostContext.Provider, {
        value: context.host,
        get children() {
          return createComponent(component, mergeProps(current));
        },
      });
    };
  };
}
