import {
  type DocumentMentionDecoratorProps,
  DocumentMentionNode,
} from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view';
import type { JsonObject } from '@macro-inc/lexical-wasm-view/view/types';
import type { DocumentMentionHost } from './document-mention-host';
import {
  createNativeDecoratorAdapter,
  type NativeDecoratorContext,
} from './native-adapter';

function stringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

function string(data: JsonObject, key: string): string {
  const value = data[key];
  if (typeof value !== 'string')
    throw new Error(`Invalid native document mention ${key}`);
  return value;
}
function optionalString(
  data: JsonObject,
  key: string
): string | null | undefined {
  const value = data[key];
  if (value === undefined || value === null || typeof value === 'string')
    return value;
  throw new Error(`Invalid native document mention ${key}`);
}
/** Typed Source props and the actual initialized component; no JS model node. */
export function createNativeDocumentMentionViews(
  context: NativeDecoratorContext<DocumentMentionHost>
): Pick<MacroDecorators, 'document-mention'> {
  const bind = createNativeDecoratorAdapter(context);
  return {
    'document-mention': bind<
      DocumentMentionDecoratorProps & { host: DocumentMentionHost }
    >(DocumentMentionNode, (node, context) => {
      if (node.decoratorRevision === undefined)
        throw new Error(
          'Document decorators require actual native signature revision metadata'
        );
      const data = node.props();
      const blockParams = data.blockParams;
      if (!stringRecord(blockParams))
        throw new Error('Invalid native document mention blockParams');
      const collapsed = data.collapsed;
      if (typeof collapsed !== 'boolean')
        throw new Error('Invalid native document mention collapsed');
      const createdAt = data.createdAt;
      if (createdAt !== undefined && typeof createdAt !== 'number')
        throw new Error('Invalid native document mention createdAt');
      return {
        key: String(node.key),
        theme: context.theme,
        host: context.host,
        documentId: string(data, 'documentId'),
        documentName: string(data, 'documentName'),
        blockName: string(data, 'blockName'),
        blockParams,
        mentionUuid: optionalString(data, 'mentionUuid'),
        collapsed,
        channelType: optionalString(data, 'channelType'),
        createdAt,
      };
    }),
  };
}
