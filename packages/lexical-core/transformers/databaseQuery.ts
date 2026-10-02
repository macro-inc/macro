import type {
  ElementTransformer,
  TextMatchTransformer,
} from '@lexical/markdown';
import { $createParagraphNode } from 'lexical';
import {
  $createDatabaseQueryNode,
  $isDatabaseQueryNode,
  DatabaseQueryNode,
  databaseQueryMarkdown,
  parseDatabaseQueryJson,
} from '../nodes/DatabaseQueryNode';
import {
  replaceElementWithUnknownMention,
  replaceTextWithUnknownMention,
  UnknownMentionNode,
} from './unknownFallback';

export const I_DATABASE_QUERY_BLOCK: ElementTransformer = {
  dependencies: [DatabaseQueryNode, UnknownMentionNode],
  type: 'element',
  regExp: /^<m-db-query>(.*?)<\/m-db-query>$/,
  export: (node) =>
    $isDatabaseQueryNode(node) && !node.isInline()
      ? databaseQueryMarkdown(node.exportComponentProps())
      : null,
  replace: (parent, _, match) => {
    const data = parseDatabaseQueryJson(match[1]);
    if (!data) {
      replaceElementWithUnknownMention(parent, 'Unavailable database question');
      return;
    }
    const node = $createDatabaseQueryNode(data);
    parent.replace(
      data.displayMode !== 'scalar' ? node : $createParagraphNode().append(node)
    );
  },
};

export const I_DATABASE_QUERY: TextMatchTransformer = {
  dependencies: [DatabaseQueryNode, UnknownMentionNode],
  type: 'text-match',
  regExp: /<m-db-query>(.*?)<\/m-db-query>/,
  importRegExp: /<m-db-query>(.*?)<\/m-db-query>/,
  export: (node) =>
    $isDatabaseQueryNode(node) && node.isInline()
      ? databaseQueryMarkdown(node.exportComponentProps())
      : null,
  replace: (node, match) => {
    const data = parseDatabaseQueryJson(match[1]);
    if (!data) {
      replaceTextWithUnknownMention(node, 'Unavailable database question');
      return;
    }
    // A block answer embedded in a sentence remains a scalar affordance until edited.
    node.replace($createDatabaseQueryNode({ ...data, displayMode: 'scalar' }));
  },
};
