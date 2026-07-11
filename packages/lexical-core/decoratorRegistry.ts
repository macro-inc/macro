import type { Klass, LexicalNode } from 'lexical';
import type { AwaitDecoratorProps, AwaitNode } from './nodes/AwaitNode';
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
  GroupMentionDecoratorProps,
  GroupMentionNode,
} from './nodes/GroupMentionNode';
import type {
  HorizontalRuleDecoratorProps,
  HorizontalRuleNode,
} from './nodes/HorizontalRuleNode';
import type {
  HtmlRenderDecoratorProps,
  HtmlRenderNode,
} from './nodes/HtmlRenderNode';
import type { ImageDecoratorProps, ImageNode } from './nodes/ImageNode';
import type { PasteNode, PasteNodeDecoratorProps } from './nodes/PasteNode';
import type {
  PullRequestMentionDecoratorProps,
  PullRequestMentionNode,
} from './nodes/PullRequestMentionNode';
import type {
  SnapshotDecoratorProps,
  SnapshotNode,
} from './nodes/SnapshotNode';
import type {
  ThemeMentionDecoratorProps,
  ThemeMentionNode,
} from './nodes/ThemeMentionNode';
import type {
  UnknownMentionDecoratorProps,
  UnknownMentionNode,
} from './nodes/UnknownMentionNode';
import type {
  UserMentionDecoratorProps,
  UserMentionNode,
} from './nodes/UserMentionNode';
import type { VideoDecoratorProps, VideoNode } from './nodes/VideoNode';
import type {
  WatermarkDecoratorProps,
  WatermarkNode,
} from './nodes/WatermarkNode';

// Generic component type to be overridden by solid-js on the front end
// and nothing on the backend.
export type DecoratorComponent<P extends {}> = (props: P) => any;

// Maps node type names to their class and props types
// This provides compile-time type safety for decorator registration
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
  GroupMentionNode: {
    klass: typeof GroupMentionNode;
    props: GroupMentionDecoratorProps;
  };
  DocumentMentionNode: {
    klass: typeof DocumentMentionNode;
    props: DocumentMentionDecoratorProps;
  };
  DocumentCardNode: {
    klass: typeof DocumentCardNode;
    props: DocumentCardDecoratorProps;
  };
  PasteNode: {
    klass: typeof PasteNode;
    props: PasteNodeDecoratorProps;
  };
  ContactMentionNode: {
    klass: typeof ContactMentionNode;
    props: ContactMentionDecoratorProps;
  };
  DateMentionNode: {
    klass: typeof DateMentionNode;
    props: DateMentionDecoratorProps;
  };
  PullRequestMentionNode: {
    klass: typeof PullRequestMentionNode;
    props: PullRequestMentionDecoratorProps;
  };
  EquationNode: {
    klass: typeof EquationNode;
    props: EquationDecoratorProps;
  };
  SnapshotNode: {
    klass: typeof SnapshotNode;
    props: SnapshotDecoratorProps;
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
  ThemeMentionNode: {
    klass: typeof ThemeMentionNode;
    props: ThemeMentionDecoratorProps;
  };
  WatermarkNode: {
    klass: typeof WatermarkNode;
    props: WatermarkDecoratorProps;
  };
  UnknownMentionNode: {
    klass: typeof UnknownMentionNode;
    props: UnknownMentionDecoratorProps;
  };
  AwaitNode: {
    klass: typeof AwaitNode;
    props: AwaitDecoratorProps;
  };
}

const decoratorRegistry = new Map<
  Klass<LexicalNode>,
  DecoratorComponent<any>
>();

// Type-safe registration: caller specifies both the node class and props type explicitly
export function setDecorator<TProps extends {}>(
  klass: Klass<LexicalNode>,
  component: DecoratorComponent<TProps>
): void {
  decoratorRegistry.set(klass, component);
}

// Simple retrieval: caller specifies the props type they expect
// This avoids complex conditional type inference that can fail
export function getDecorator<TProps extends {}>(
  klass: Klass<LexicalNode>
): DecoratorComponent<TProps> | undefined {
  const decorator = decoratorRegistry.get(klass);
  return decorator as DecoratorComponent<TProps> | undefined;
}

export function clearDecorators() {
  decoratorRegistry.clear();
}
