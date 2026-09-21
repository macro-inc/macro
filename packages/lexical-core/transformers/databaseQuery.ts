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
  parseDatabaseQueryData,
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
    try {
      const data = parseDatabaseQueryData(JSON.parse(match[1]));
      if (!data) throw new Error('Invalid query');
      const node = $createDatabaseQueryNode(data);
      parent.replace(
        data.displayMode !== 'scalar'
          ? node
          : $createParagraphNode().append(node)
      );
    } catch {
      replaceElementWithUnknownMention(parent, 'Unavailable database question');
    }
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
    try {
      const data = parseDatabaseQueryData(JSON.parse(match[1]));
      if (!data) throw new Error('Invalid query');
      // A block answer embedded in a sentence remains a scalar affordance until edited.
      node.replace(
        $createDatabaseQueryNode({ ...data, displayMode: 'scalar' })
      );
    } catch {
      replaceTextWithUnknownMention(node, 'Unavailable database question');
    }
  },
};
