import type { Klass, LexicalNode } from 'lexical';
import type {
  ContactMentionDecoratorProps,
  ContactMentionNode,
} from './nodes/ContactMentionNode';
import type {
  DateMentionDecoratorProps,
  DateMentionNode,
} from './nodes/DateMentionNode';
import type {
  DiffInsertDecoratorProps,
  DiffInsertNode,
} from './nodes/DiffInsertNode';
import type {
  DocumentCardDecoratorProps,
  DocumentCardNode,
} from './nodes/DocumentCardNode';
import type {
  DocumentMentionDecoratorProps,
  DocumentMentionNode,
} from './nodes/DocumentMentionNode';
import type {
  EquationDecoratorProps,
  EquationNode,
} from './nodes/EquationNode';
import type {
  HorizontalRuleDecoratorProps,
  HorizontalRuleNode,
} from './nodes/HorizontalRuleNode';
import type {
  HtmlRenderDecoratorProps,
  HtmlRenderNode,
} from './nodes/HtmlRenderNode';
import type { ImageDecoratorProps, ImageNode } from './nodes/ImageNode';
import type {
  UserMentionDecoratorProps,
  UserMentionNode,
} from './nodes/UserMentionNode';
import type { VideoDecoratorProps, VideoNode } from './nodes/VideoNode';

// Generic component type to be overridden by solid-js on the front end
// and nothing on the backend.
export type DecoratorComponent<P extends {}> = (props: P) => any;

export interface NodeDecoratorMap {
  DiffInsertNode: {
    klass: typeof DiffInsertNode;
    props: DiffInsertDecoratorProps;
  };
  HorizontalRuleNode: {
    klass: typeof HorizontalRuleNode;
    props: HorizontalRuleDecoratorProps;
  };
  UserMentionNode: {
    klass: typeof UserMentionNode;
    props: UserMentionDecoratorProps;
  };
  DocumentMentionNode: {
    klass: typeof DocumentMentionNode;
    props: DocumentMentionDecoratorProps;
  };
  DocumentCardNode: {
    klass: typeof DocumentCardNode;
    props: DocumentCardDecoratorProps;
  };
  ContactMentionNode: {
    klass: typeof ContactMentionNode;
    props: ContactMentionDecoratorProps;
  };
  DateMentionNode: {
    klass: typeof DateMentionNode;
    props: DateMentionDecoratorProps;
  };
  EquationNode: {
    klass: typeof EquationNode;
    props: EquationDecoratorProps;
  };
  ImageNode: {
    klass: typeof ImageNode;
    props: ImageDecoratorProps;
  };
  VideoNode: {
    klass: typeof VideoNode;
    props: VideoDecoratorProps;
  };
  HtmlRenderNode: {
    klass: typeof HtmlRenderNode;
    props: HtmlRenderDecoratorProps;
  };
}

export type NodeClassToProps<T extends LexicalNode> = T extends InstanceType<
  NodeDecoratorMap[keyof NodeDecoratorMap]['klass']
>
  ? Extract<
      NodeDecoratorMap[keyof NodeDecoratorMap],
      { klass: new (...args: any) => T }
    >['props']
  : never;

const decoratorRegistry = new Map<
  Klass<LexicalNode>,
  DecoratorComponent<any>
>();

export function setDecorator<T extends LexicalNode>(
  klass: Klass<T>,
  component: DecoratorComponent<NodeClassToProps<T>>
): void {
  decoratorRegistry.set(klass, component);
}

export function getDecorator<T extends LexicalNode>(
  klass: Klass<T>
): DecoratorComponent<NodeClassToProps<T>> | undefined {
  return decoratorRegistry.get(klass);
}

export function clearDecorators() {
  decoratorRegistry.clear();
}
