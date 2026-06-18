import { URL_PARAMS as MD_URL_PARAMS } from '@block-md/constants';
import { URL_PARAMS as PDF_URL_PARAMS } from '@block-pdf/signal/location';
import { itemToBlockName } from '@core/constant/allBlocks';
import { useChannelsContext } from '@core/context/channels';

import {
  type AccessiblePreviewItem,
  getItemPreview,
  isAccessiblePreviewItem,
} from '@queries/preview';
import { cognitionApiServiceClient } from '@service-cognition/client';
import type { ItemType } from '@service-storage/client';
import { validate as uuidValidate } from 'uuid';

export const jsonToXML = (tag: string, data: object) => {
  return `<${tag}>${JSON.stringify(data)}</${tag}>`;
};

const fetchMentionPreview = async (
  id: string,
  type: Exclude<ItemType, 'channel'>
): Promise<AccessiblePreviewItem | undefined> => {
  try {
    const preview = await getItemPreview({ id, type });
    return isAccessiblePreviewItem(preview) ? preview : undefined;
  } catch {
    return undefined;
  }
};

const createDocumentMentionXML = async (documentId: string) => {
  const item = await fetchMentionPreview(documentId, 'document');
  if (!item) {
    if (import.meta.env.DEV) {
      console.error('Could not find item', documentId);
    }
    return jsonToXML('m-document-mention', {
      documentId,
      blockName: 'md',
      documentName: '',
      blockParams: {},
    });
  }
  const blockName = itemToBlockName(item);
  return jsonToXML('m-document-mention', {
    documentId,
    blockName,
    documentName: item.name,
    blockParams: {},
  });
};

const createChatMentionXML = async (chatId: string) => {
  const chat = await fetchMentionPreview(chatId, 'chat');
  if (!chat) {
    if (import.meta.env.DEV) {
      console.error('Could not find chat', chatId);
    }
    return jsonToXML('m-document-mention', {
      documentId: chatId,
      blockName: 'chat',
      documentName: '',
      blockParams: {},
    });
  }
  return jsonToXML('m-document-mention', {
    documentId: chatId,
    blockName: 'chat',
    documentName: chat.name,
    blockParams: {},
  });
};

const createChannelMentionXML = (channelId: string) => {
  const channelsContext = useChannelsContext();
  const channel = channelsContext.channels().find((c) => c.id === channelId);
  if (!channel) {
    if (import.meta.env.DEV) {
      console.error('Could not find channel', channelId);
    }
    return jsonToXML('m-document-mention', {
      documentId: channelId,
      blockName: 'channel',
      documentName: '',
      blockParams: {},
    });
  }
  return jsonToXML('m-document-mention', {
    documentId: channel.id,
    blockName: 'channel',
    documentName: channel.name,
    blockParams: {},
  });
};

const createProjectMentionXML = async (projectId: string) => {
  const project = await fetchMentionPreview(projectId, 'project');
  if (!project) {
    if (import.meta.env.DEV) {
      console.error('Could not find project', projectId);
    }
    return jsonToXML('m-document-mention', {
      documentId: projectId,
      blockName: 'project',
      documentName: '',
      blockParams: {},
    });
  }
  return jsonToXML('m-document-mention', {
    documentId: project.id,
    blockName: 'project',
    documentName: project.name,
    blockParams: {},
  });
};

const _createDateMentionXML = (
  date: Date,
  displayFormat: string,
  mentionUuid?: string
) => {
  return jsonToXML('m-date-mention', {
    date: date.toISOString(),
    displayFormat,
    mentionUuid,
  });
};

const getPdfCitationInfo = async (citationId: string) => {
  try {
    const response = await cognitionApiServiceClient.getCitation({
      id: citationId,
    });
    if (response.isOk()) {
      const textPart = response.value;
      const documentId = textPart.document_id;
      const blockName = textPart.reference.kind;
      if (blockName === 'pdf') {
        const blockParams = {
          [PDF_URL_PARAMS.pageNumber]: `${textPart.reference.page_index}`,
          [PDF_URL_PARAMS.yPos]: `${textPart.reference.top}`,
          [PDF_URL_PARAMS.x]: `${textPart.reference.left}`,
          [PDF_URL_PARAMS.width]: `${textPart.reference.width}`,
          [PDF_URL_PARAMS.height]: `${textPart.reference.height}`,
        };

        return jsonToXML('m-document-mention', {
          documentId,
          blockName,
          documentName: '',
          blockParams,
          collapsed: true,
        });
      } else {
        console.error('Unsupported Citation Document Type', blockName);
        return '';
      }
    }
  } catch (err: any) {
    console.error(err);
  }
  return '';
};

const getMdNodeCitationInfo = async (documentId: string, nodeId: string) => {
  const blockParams = {
    [MD_URL_PARAMS.nodeId]: nodeId,
  };
  const item = await fetchMentionPreview(documentId, 'document');
  const blockName = item ? (itemToBlockName(item) ?? 'md') : 'md';
  return jsonToXML('m-document-mention', {
    documentId,
    blockName,
    documentName: '',
    blockParams,
    collapsed: true,
  });
};

// TODO: can also check if the document id exists in the db
const isDocumentId = (id: string) => {
  return uuidValidate(id);
};

const DEFAULT_NANO_ID_REGEX = new RegExp(/^[A-Za-z0-9_-]{8}$/);

/**
 * Checks if a string is a valid nano id.
 * Default length is 8 but can be overridden
 * See: nodeIdPlugin.ts
 * TODO: can also check if the node id exists for a given document id
 */
const isNanoId = (id: string, length: number = 8) => {
  const regex =
    length === 8
      ? DEFAULT_NANO_ID_REGEX
      : new RegExp(`^[A-Za-z0-9_-]{${length}}$`);
  return regex.test(id);
};

const isMdCitation = (citation: string) => {
  return citation.startsWith('md;');
};

// For now citations are just single uuids
const isPdfCitation = (citation: string) => {
  return uuidValidate(citation);
};

const isDocumentMention = (citation: string) => {
  if (!citation.startsWith('document-mention;')) return false;
  const [, documentId] = citation.split(';', 2);
  return uuidValidate(documentId);
};

const isChannelMention = (citation: string) => {
  if (!citation.startsWith('channel-mention;')) return false;
  const [, channelId] = citation.split(';', 2);
  return uuidValidate(channelId);
};

const isChatMention = (citation: string) => {
  if (!citation.startsWith('chat-mention;')) return false;
  const [, chatId] = citation.split(';', 2);
  return uuidValidate(chatId);
};

const isProjectMention = (citation: string) => {
  if (!citation.startsWith('project-mention;')) return false;
  const [, projectId] = citation.split(';', 2);
  return uuidValidate(projectId);
};

// splits a citation formatted as [md;{{documentId}};{{nodeId}}]
// note that semicolons are not allowed in uuids/nano ids so it is safe to split on semicolon
const splitMdCitation = (
  citation: string
): { documentId: string; nodeId: string } | undefined => {
  if (!citation) return undefined;
  const [_format, documentId, nodeId] = citation.split(';', 3);
  return { documentId, nodeId };
};

export const replaceCitations = async (input: string): Promise<string> => {
  const citationRegex = /\[\[(.*?)\]\]/g;

  const citationCache = new Map<string, string>();
  // async lookups, started concurrently so the preview dataloader can batch them
  const pendingCitations = new Map<string, Promise<string>>();
  const matches = [...input.matchAll(citationRegex)];
  for (const match of matches) {
    const citation = match[1];
    if (citationCache.has(citation) || pendingCitations.has(citation)) {
      continue;
    }
    if (isMdCitation(citation)) {
      const splitCitation = splitMdCitation(citation);
      if (!splitCitation) {
        if (import.meta.env.DEV) {
          console.error('Invalid citation', citation);
        }
        citationCache.set(citation, '');
        continue;
      }

      const { documentId, nodeId } = splitCitation;
      if (!isDocumentId(documentId) || !isNanoId(nodeId)) {
        if (import.meta.env.DEV) {
          console.error('Invalid citation', citation);
        }
        citationCache.set(citation, '');
        continue;
      }

      pendingCitations.set(citation, getMdNodeCitationInfo(documentId, nodeId));
    } else if (isDocumentMention(citation)) {
      const [, itemId] = citation.split(';', 2);
      pendingCitations.set(citation, createDocumentMentionXML(itemId));
    } else if (isChannelMention(citation)) {
      const [, channelId] = citation.split(';', 2);
      const xml = createChannelMentionXML(channelId);
      citationCache.set(citation, xml);
    } else if (isChatMention(citation)) {
      const [, chatId] = citation.split(';', 2);
      pendingCitations.set(citation, createChatMentionXML(chatId));
    } else if (isProjectMention(citation)) {
      const [, projectId] = citation.split(';', 2);
      pendingCitations.set(citation, createProjectMentionXML(projectId));
    } else if (isPdfCitation(citation)) {
      pendingCitations.set(citation, getPdfCitationInfo(citation));
    } else {
      if (import.meta.env.DEV) {
        console.error('Invalid citation', citation);
      }
      citationCache.set(citation, '');
    }
  }

  await Promise.all(
    [...pendingCitations].map(async ([citation, xml]) => {
      citationCache.set(citation, await xml);
    })
  );

  return input.replace(citationRegex, (_match, citation) => {
    return citationCache.get(citation) || '';
  });
};
