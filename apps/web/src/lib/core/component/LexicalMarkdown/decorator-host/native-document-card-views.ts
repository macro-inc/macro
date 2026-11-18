import {
  DocumentCardNode,
  type DocumentCardPreviewInput,
  type PreviewBox,
} from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view';
import type { JsonObject } from '@macro-inc/lexical-wasm-view/view/types';
import type { DocumentCardProps } from '../component/decorator/DocumentCard';
import { createNativeDecoratorAdapter } from './native-adapter';
import type { NativeDocumentCardContext } from './native-document-card-host';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function stringRecord(value: unknown): value is Record<string, string> {
  return (
    record(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}
function string(data: JsonObject, key: string): string {
  const value = data[key];
  if (typeof value !== 'string') throw new Error(`Invalid native card ${key}`);
  return value;
}
function optionalString(
  data: JsonObject,
  key: string
): string | null | undefined {
  const value = data[key];
  if (value === undefined || value === null || typeof value === 'string')
    return value;
  throw new Error(`Invalid native card ${key}`);
}
function dimension(value: unknown): value is string | number {
  return typeof value === 'string' || typeof value === 'number';
}
function previewBox(value: unknown): value is PreviewBox {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    dimension(value[0]) &&
    dimension(value[1])
  );
}
function previewData(value: unknown): value is DocumentCardPreviewInput {
  if (Array.isArray(value)) return !('view' in value);
  if (!record(value)) return false;
  if (!('view' in value)) return true;
  const view = value.view;
  return (
    record(view) &&
    typeof view.x === 'number' &&
    typeof view.y === 'number' &&
    typeof view.scale === 'number'
  );
}
/** Actual registered card component with a view-owned preview registry and durable IDs. */
export function createNativeDocumentCardViews(
  context: NativeDocumentCardContext
): Pick<MacroDecorators, 'document-card'> {
  const bind = createNativeDecoratorAdapter(context);
  return {
    'document-card': bind<DocumentCardProps>(
      DocumentCardNode,
      (node, binding) => {
        if (node.decoratorRevision === undefined)
          throw new Error(
            'Document decorators require actual native signature revision metadata'
          );
        const data = node.props();
        const params = data.blockParams;
        if (!stringRecord(params))
          throw new Error('Invalid native card blockParams');
        const box = data.previewBox;
        if (!previewBox(box)) throw new Error('Invalid native card previewBox');
        const preview = data.previewData;
        if (preview !== undefined && preview !== null && !previewData(preview))
          throw new Error('Invalid native card previewData');
        return {
          key: String(node.key),
          theme: binding.theme,
          host: binding.host,
          documentId: string(data, 'documentId'),
          documentName: string(data, 'documentName'),
          blockName: string(data, 'blockName'),
          blockParams: params,
          previewBox: box,
          previewData: preview,
          mentionUuid: optionalString(data, 'mentionUuid'),
          previewComponent: context.previewComponent(String(node.key)),
        };
      }
    ),
  };
}
