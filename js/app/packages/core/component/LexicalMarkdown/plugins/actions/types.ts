import type { KlassConstructor, LexicalEditor, LexicalNode } from 'lexical';
import type { Component } from 'solid-js';

export type Action = {
  id: string;
  name: string;
  keywords: string[];
  icon: Component<{ class: string }>;
  category: string;
  action: (editor: LexicalEditor) => void;
  shortcut?: string;
  dependencies?: Array<KlassConstructor<typeof LexicalNode>>;
};

// TODO (seamus): Actually organize the items based on category.
export enum ActionCategory {
  FORMAT = 'Formatting',
  ELEMENT = 'Elements',
  MEDIA = 'Media',
}
