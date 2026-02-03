import type { BlockAlias, BlockName } from '@core/block';
import { entityPropertyFromApi } from '@core/component/Properties/api/converters';
import type { Property } from '@core/component/Properties/types';
import { trackMention } from '@core/signal/mention';
import { isErr, isOk } from '@core/util/maybeResult';
import { fetchDocumentAsMarkdown } from '@queries/storage/markdownText';
import { propertiesServiceClient } from '@service-properties/client';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import { storageServiceClient } from '@service-storage/client';
import type { Item } from '@service-storage/generated/schemas/item';
import { INSERT_SNAPSHOT_NODE_COMMAND } from '../plugins/mentions';
import {
  entityMapper,
  getCombinedEntityBlockName,
  getItemName,
  type HandlerDependencies,
  handleBasicMention,
} from './mentionsUtils';

/** Document types that support SnapshotNode (text-based content) */
// TODO
const SNAPSHOT_SUPPORTED_BLOCK_NAMES: Set<BlockName | BlockAlias> = new Set([
  'task',
  'write',
  'md',
  'code',
]);

/**
 * Maps block name to properties service EntityType.
 * Returns null for block types that don't support properties.
 */
function blockNameToEntityType(blockName: string): EntityType | null {
  switch (blockName) {
    case 'md':
      return EntityType.DOCUMENT;
    case 'task':
      return EntityType.TASK;
    default:
      return null;
  }
}

/**
 * Formats a property value to a string representation.
 */
function formatPropertyValue(property: Property): string | null {
  if (property.value === null) {
    return null;
  }

  switch (property.valueType) {
    case 'STRING':
      return property.value;
    case 'NUMBER':
      return String(property.value);
    case 'BOOLEAN':
      return property.value ? 'true' : 'false';
    case 'DATE':
      return property.value.toISOString().split('T')[0];
    case 'SELECT_STRING':
    case 'SELECT_NUMBER': {
      if (!property.value || property.value.length === 0) {
        return null;
      }
      // Map option IDs to display values
      const selectedLabels = property.value
        .map((optionId) => {
          const option = property.options?.find((opt) => opt.id === optionId);
          return option?.value?.value ?? optionId;
        })
        .filter(Boolean);
      return selectedLabels.length > 0 ? selectedLabels.join(', ') : null;
    }
    case 'ENTITY': {
      if (!property.value || property.value.length === 0) {
        return null;
      }
      // Format entity references as type:id pairs
      return property.value
        .map((ref) => `${ref.entity_type}:${ref.entity_id}`)
        .join(', ');
    }
    case 'LINK': {
      if (!property.value || property.value.length === 0) {
        return null;
      }
      return property.value.join(', ');
    }
    default: {
      const _exhaustive: never = property;
      return null;
    }
  }
}

/**
 * Formats properties as YAML front matter.
 * Returns empty string if no properties have values.
 */
function formatPropertiesAsYamlFrontMatter(properties: Property[]): string {
  const lines: string[] = [];

  for (const property of properties) {
    const value = formatPropertyValue(property);
    if (value !== null) {
      // Escape special YAML characters in the value if needed
      const needsQuoting = value.includes(':') || value.includes('#');
      const formattedValue = needsQuoting ? `"${value}"` : value;
      lines.push(`${property.displayName}: ${formattedValue}`);
    }
  }

  if (lines.length === 0) {
    return '';
  }

  return `---\n${lines.join('\n')}\n---\n\n`;
}

/**
 * Check if a block name supports SnapshotNode insertion.
 * SnapshotNode is used for text-based documents where content can be displayed inline.
 */
export function supportsSnapshotNode(
  blockName: BlockName | BlockAlias
): boolean {
  return SNAPSHOT_SUPPORTED_BLOCK_NAMES.has(blockName);
}

/**
 * Insert a SnapshotNode with document content for supported document types.
 * Falls back to handleBasicMention for unsupported types or errors.
 * @param item The document item to mention
 * @param dependencies Handler dependencies
 */
export async function handleSnapshotMention(
  item: Item,
  dependencies: HandlerDependencies
) {
  const {
    editor,
    blockName: parentBlockName,
    blockId,
    onDocumentMention,
    disableMentionTracking,
  } = dependencies;

  const itemEntity = entityMapper('item')(item);
  const itemBlock = getCombinedEntityBlockName(itemEntity);
  const itemName = getItemName(itemEntity);

  // Check if this document type supports SnapshotNode
  if (!supportsSnapshotNode(itemBlock)) {
    return handleBasicMention(item, dependencies);
  }

  let text: string;
  let propertiesFrontMatter = '';

  if (itemBlock === 'md' || itemBlock === 'task') {
    const entityType = blockNameToEntityType(itemBlock);

    // Fetch content and properties in parallel
    const [contentResult, propsResult] = await Promise.all([
      fetchDocumentAsMarkdown(item.id, 'internal'),
      entityType
        ? propertiesServiceClient.getEntityProperties({
            entity_type: entityType,
            entity_id: item.id,
            query: { include_metadata: true },
          })
        : Promise.resolve(null),
    ]);

    if (!contentResult) {
      console.error('failed to fetch md');
      return;
    }
    text = contentResult;

    if (propsResult && isOk(propsResult)) {
      const properties = propsResult[1].properties.map(entityPropertyFromApi);
      propertiesFrontMatter = formatPropertiesAsYamlFrontMatter(properties);
    }
  } else {
    // Fetch document content
    const result = await storageServiceClient.getTextDocument({
      documentId: item.id,
    });

    if (isErr(result)) {
      // Fall back to regular mention on error
      console.error(
        'Failed to fetch document content for SnapshotNode:',
        result
      );
      return;
    }
    text = result[1].text;
  }

  let mentionId: string | undefined;
  if (
    blockId &&
    parentBlockName !== 'channel' &&
    parentBlockName !== 'chat' &&
    !disableMentionTracking
  ) {
    mentionId = await trackMention(blockId, 'document', item.id);
  }

  onDocumentMention?.(item);

  editor.dispatchCommand(INSERT_SNAPSHOT_NODE_COMMAND, {
    documentId: item.id,
    documentName: itemName,
    blockName: itemBlock,
    content: propertiesFrontMatter + text,
    snapshotDate: new Date().toISOString(),
    mentionUuid: mentionId,
  });
}
