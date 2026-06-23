import type {
  ElementTransformer,
  TextMatchTransformer,
} from '@lexical/markdown';
import type { ElementNode, LexicalNode, TextNode } from 'lexical';
import { ContactMentionNode } from '../nodes/ContactMentionNode';
import { DateMentionNode } from '../nodes/DateMentionNode';
import { DocumentCardNode } from '../nodes/DocumentCardNode';
import { DocumentMentionNode } from '../nodes/DocumentMentionNode';
import { GroupMentionNode } from '../nodes/GroupMentionNode';
import { PullRequestMentionNode } from '../nodes/PullRequestMentionNode';
import { ThemeMentionNode } from '../nodes/ThemeMentionNode';
import { UserMentionNode } from '../nodes/UserMentionNode';

// NOTE: If you are changing this file, you may need to update the `mention_utils` crate in `macro-api` as well. Please notify @hutch should you update this file.

// Internal User Mentions
export const I_USER_MENTION: TextMatchTransformer = {
  dependencies: [UserMentionNode],
  type: 'text-match',
  regExp: /<m-user-mention>(.*?)<\/m-user-mention>/,
  importRegExp: /<m-user-mention>(.*?)<\/m-user-mention>/,
  export: (node) => {
    if (!(node instanceof UserMentionNode)) return null;
    const data = JSON.stringify({
      userId: node.getUserId(),
      email: node.getEmail(),
    });
    return `<m-user-mention>${data}</m-user-mention>`;
  },
  replace: (node: TextNode, match: RegExpMatchArray) => {
    try {
      const data = JSON.parse(match[1]);
      for (const field of ['userId', 'email']) {
        if (!(field in data)) throw new Error(`Missing field ${field}`);
      }
      const userMentionNode = new UserMentionNode(data.userId, data.email);
      node.replace(userMentionNode);
    } catch (e) {
      console.error('Error in I_USER_MENTION replace:', e);
    }
  },
};

// External User Mentions
export const E_USER_MENTION: ElementTransformer = {
  dependencies: [UserMentionNode],
  type: 'element',
  regExp: /$^/,
  export: (node) => {
    if (!(node instanceof UserMentionNode)) return null;

    const userId = node.getUserId();
    if (!userId) {
      return null;
    }

    return `${userId}`;
  },
  replace: (
    _parentNode: ElementNode,
    _children: Array<LexicalNode>,
    _match: Array<string>,
    _isImport: boolean
  ) => {
    return false;
  },
};

// Internal Contact Mentions
export const I_CONTACT_MENTION: TextMatchTransformer = {
  dependencies: [ContactMentionNode],
  type: 'text-match',
  regExp: /<m-contact-mention>(.*?)<\/m-contact-mention>/,
  importRegExp: /<m-contact-mention>(.*?)<\/m-contact-mention>/,
  export: (node) => {
    if (!(node instanceof ContactMentionNode)) return null;
    const data = JSON.stringify({
      contactId: node.getContactId(),
      name: node.getName(),
      emailOrDomain: node.getEmailOrDomain(),
      isCompany: node.getIsCompany(),
    });
    return `<m-contact-mention>${data}</m-contact-mention>`;
  },
  replace: (node: TextNode, match: RegExpMatchArray) => {
    try {
      const data = JSON.parse(match[1]);
      for (const field of ['contactId', 'name', 'emailOrDomain', 'isCompany']) {
        if (!(field in data)) throw new Error(`Missing field ${field}`);
      }
      const contactMentionNode = new ContactMentionNode(
        data.contactId,
        data.name,
        data.emailOrDomain,
        data.isCompany
      );
      node.replace(contactMentionNode);
    } catch (e) {
      console.error(e);
    }
  },
};

// External Contact Mentions
export const E_CONTACT_MENTION: ElementTransformer = {
  dependencies: [ContactMentionNode],
  type: 'element',
  regExp: /$^/,
  export: (node) => {
    if (!(node instanceof ContactMentionNode)) return null;

    const name = node.getName();
    const emailOrDomain = node.getEmailOrDomain();

    if (!name || !emailOrDomain) {
      return null;
    }

    // For external representation, just show the email/domain
    return emailOrDomain;
  },
  replace: (
    _parentNode: ElementNode,
    _children: Array<LexicalNode>,
    _match: Array<string>,
    _isImport: boolean
  ) => {
    return false;
  },
};

// Internal Date Mentions
export const I_DATE_MENTION: TextMatchTransformer = {
  dependencies: [DateMentionNode],
  type: 'text-match',
  regExp: /<m-date-mention>(.*?)<\/m-date-mention>/,
  importRegExp: /<m-date-mention>(.*?)<\/m-date-mention>/,
  export: (node) => {
    if (!(node instanceof DateMentionNode)) return null;
    const data = JSON.stringify({
      date: node.getDate(),
      displayFormat: node.getDisplayFormat(),
      mentionUuid: node.getMentionUuid(),
    });
    return `<m-date-mention>${data}</m-date-mention>`;
  },
  replace: (node: TextNode, match: RegExpMatchArray) => {
    try {
      const data = JSON.parse(match[1]);
      for (const field of ['date', 'displayFormat']) {
        if (!(field in data)) throw new Error(`Missing field ${field}`);
      }
      const dateMentionNode = new DateMentionNode(
        data.date,
        data.displayFormat,
        data.mentionUuid
      );
      node.replace(dateMentionNode);
    } catch (e) {
      console.error(e);
    }
  },
};

// External Date Mentions
export const E_DATE_MENTION: ElementTransformer = {
  dependencies: [DateMentionNode],
  type: 'element',
  regExp: /$^/,
  export: (node) => {
    if (!(node instanceof DateMentionNode)) return null;

    const displayFormat = node.getDisplayFormat();
    if (!displayFormat) {
      return null;
    }

    // For external representation, just show the display format
    return displayFormat;
  },
  replace: (
    _parentNode: ElementNode,
    _children: Array<LexicalNode>,
    _match: Array<string>,
    _isImport: boolean
  ) => {
    return false;
  },
};

// Internal Document Mentions

export const I_DOCUMENT_MENTION: TextMatchTransformer = {
  dependencies: [DocumentMentionNode],
  type: 'text-match',
  regExp: /<m-document-mention>(.*?)<\/m-document-mention>/,
  importRegExp: /<m-document-mention>(.*?)<\/m-document-mention>/,
  export: (node) => {
    if (!(node instanceof DocumentMentionNode)) return null;
    const data = JSON.stringify({
      documentId: node.getDocumentId(),
      blockName: node.getBlockName(),
      documentName: node.getDocumentName(),
      blockParams: node.getBlockParams(),
      collapsed: node.getCollapsed(),
    });
    return `<m-document-mention>${data}</m-document-mention>`;
  },
  replace: (node: TextNode, match: RegExpMatchArray) => {
    try {
      const data = JSON.parse(match[1]);
      for (const field of ['documentId', 'documentName']) {
        if (!(field in data)) throw new Error(`Missing field ${field}`);
      }
      const documentMentionNode = new DocumentMentionNode(
        data.documentId,
        data.documentName,
        data.blockName ?? 'unknown',
        data.blockParams,
        undefined,
        data.collapsed
      );
      node.replace(documentMentionNode);
    } catch (e) {
      console.error('Error in I_DOCUMENT_MENTION replace:', e);
    }
  },
};

// External Document Mentions

function cleanHostname(rawHostname: string): string {
  const hostname = rawHostname.replace('www.', '').toLowerCase();
  if (hostname === 'localhost') {
    return 'dev.macro.com';
  }
  return hostname;
}

function currentBrowserHostname(): string | null {
  if (
    typeof window === 'undefined' ||
    !window.location ||
    !window.location.hostname
  ) {
    return null;
  }
  return cleanHostname(window.location.hostname);
}

export const E_DOCUMENT_MENTION: ElementTransformer = {
  dependencies: [DocumentMentionNode],
  type: 'element',
  regExp: /$^/,
  export: (node) => {
    if (!(node instanceof DocumentMentionNode)) return null;

    const documentName = node.getDocumentName();
    const documentId = node.getDocumentId();
    const blockType = node.getBlockName();

    if (!documentName || !documentId || !blockType) {
      return null;
    }

    const hostname = cleanHostname(window.location.hostname);
    const documentUrl = `https://${hostname}/app/${blockType}/${documentId}`;
    return `[${documentName}](${documentUrl})`;
  },
  replace: (
    _parentNode: ElementNode,
    _children: Array<LexicalNode>,
    _match: Array<string>,
    _isImport: boolean
  ) => {
    return false;
  },
};

// Internal Pull Request Mentions

export const I_PR_MENTION: TextMatchTransformer = {
  dependencies: [PullRequestMentionNode],
  type: 'text-match',
  regExp: /<m-pr-mention>(.*?)<\/m-pr-mention>/,
  importRegExp: /<m-pr-mention>(.*?)<\/m-pr-mention>/,
  export: (node) => {
    if (!(node instanceof PullRequestMentionNode)) return null;
    const data = JSON.stringify({
      id: node.getId(),
      label: node.getLabel(),
      mentionUuid: node.getMentionUuid(),
    });
    return `<m-pr-mention>${data}</m-pr-mention>`;
  },
  replace: (node: TextNode, match: RegExpMatchArray) => {
    try {
      const data = JSON.parse(match[1]);
      if (!('id' in data) || typeof data.id !== 'string') {
        throw new Error('Missing field id');
      }
      const prMentionNode = new PullRequestMentionNode(
        data.id,
        typeof data.label === 'string' ? data.label : undefined,
        typeof data.mentionUuid === 'string' ? data.mentionUuid : undefined
      );
      node.replace(prMentionNode);
    } catch (e) {
      console.error('Error in I_PR_MENTION replace:', e);
    }
  },
};

// External Pull Request Mentions

export const E_PR_MENTION: ElementTransformer = {
  dependencies: [PullRequestMentionNode],
  type: 'element',
  regExp: /$^/,
  export: (node) => {
    if (!(node instanceof PullRequestMentionNode)) return null;

    const id = node.getId();
    if (!id) return null;

    const label = node.getLabel() || 'Pull request';
    const hostname = currentBrowserHostname();
    if (!hostname) return label;

    const prUrl = `https://${hostname}/app/pr/${id}`;
    return `[${label}](${prUrl})`;
  },
  replace: (
    _parentNode: ElementNode,
    _children: Array<LexicalNode>,
    _match: Array<string>,
    _isImport: boolean
  ) => {
    return false;
  },
};

// Internal Group Mentions (e.g., @here)
export const I_GROUP_MENTION: TextMatchTransformer = {
  dependencies: [GroupMentionNode],
  type: 'text-match',
  regExp: /<m-group-mention>(.*?)<\/m-group-mention>/,
  importRegExp: /<m-group-mention>(.*?)<\/m-group-mention>/,
  export: (node) => {
    if (!(node instanceof GroupMentionNode)) return null;
    const data = JSON.stringify({
      groupAlias: node.getGroupAlias(),
    });
    return `<m-group-mention>${data}</m-group-mention>`;
  },
  replace: (node: TextNode, match: RegExpMatchArray) => {
    try {
      const data = JSON.parse(match[1]);
      if (!('groupAlias' in data)) throw new Error('Missing field groupAlias');
      const groupMentionNode = new GroupMentionNode(data.groupAlias);
      node.replace(groupMentionNode);
    } catch (e) {
      console.error('Error in I_GROUP_MENTION replace:', e);
    }
  },
};

// External Group Mentions
export const E_GROUP_MENTION: ElementTransformer = {
  dependencies: [GroupMentionNode],
  type: 'element',
  regExp: /$^/,
  export: (node) => {
    if (!(node instanceof GroupMentionNode)) return null;

    const groupAlias = node.getGroupAlias();
    if (!groupAlias) {
      return null;
    }

    return `@${groupAlias}`;
  },
  replace: (
    _parentNode: ElementNode,
    _children: Array<LexicalNode>,
    _match: Array<string>,
    _isImport: boolean
  ) => {
    return false;
  },
};

// Internal Document Cards

export const I_DOCUMENT_CARD: ElementTransformer = {
  dependencies: [DocumentCardNode],
  type: 'element',
  regExp: /<m-document-card>(.*?)<\/m-document-card>/,
  export: (node) => {
    if (!(node instanceof DocumentCardNode)) return null;
    const data = JSON.stringify({
      documentId: node.getDocumentId(),
      blockName: node.getBlockName(),
      documentName: node.getDocumentName(),
      blockParams: node.getBlockParams(),
      previewBox: node.getPreviewBox(),
      previewData: node.getPreviewData(),
      mentionUuid: node.getMentionUuid(),
    });
    return `<m-document-card>${data}</m-document-card>`;
  },
  replace: (
    parentNode: ElementNode,
    _children: Array<LexicalNode>,
    match: Array<string>
  ) => {
    try {
      const data = JSON.parse(match[1]);
      for (const field of ['documentId', 'documentName', 'blockName']) {
        if (!(field in data)) throw new Error(`Missing field ${field}`);
      }
      const documentCardNode = new DocumentCardNode(
        data.documentId,
        data.documentName,
        data.blockName,
        data.blockParams,
        data.previewBox,
        data.previewData,
        data.mentionUuid
      );
      parentNode.replace(documentCardNode);
    } catch (e) {
      console.error('Error in I_DOCUMENT_CARD replace:', e);
    }
  },
};

// Internal Theme Mentions
export const I_THEME_MENTION: TextMatchTransformer = {
  dependencies: [ThemeMentionNode],
  type: 'text-match',
  regExp: /<m-theme-mention>(.*?)<\/m-theme-mention>/,
  importRegExp: /<m-theme-mention>(.*?)<\/m-theme-mention>/,
  export: (node) => {
    if (!(node instanceof ThemeMentionNode)) return null;
    const data = JSON.stringify({
      name: node.getThemeName(),
      data: node.getThemeData(),
    });
    return `<m-theme-mention>${data}</m-theme-mention>`;
  },
  replace: (node: TextNode, match: RegExpMatchArray) => {
    try {
      const parsed = JSON.parse(match[1]);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof parsed.name !== 'string'
      )
        throw new Error('Invalid theme mention JSON');
      const themeMentionNode = new ThemeMentionNode(parsed.name, parsed.data);
      node.replace(themeMentionNode);
    } catch (e) {
      console.error('Error in I_THEME_MENTION replace:', e);
    }
  },
};

// External Document Cards
export const E_DOCUMENT_CARD: ElementTransformer = {
  dependencies: [DocumentCardNode],
  type: 'element',
  regExp: /$^/,
  export: (node) => {
    if (!(node instanceof DocumentCardNode)) return null;

    const documentName = node.getDocumentName();
    const documentId = node.getDocumentId();
    const blockType = node.getBlockName();

    if (!documentName || !documentId || !blockType) {
      return null;
    }

    const hostname = cleanHostname(window.location.hostname);
    const documentUrl = `https://${hostname}/app/${blockType}/${documentId}`;
    return `[${documentName}](${documentUrl})`;
  },
  replace: (
    _parentNode: ElementNode,
    _children: Array<LexicalNode>,
    _match: Array<string>,
    _isImport: boolean
  ) => {
    return false;
  },
};
