import type { Transformer } from '@lexical/markdown';
import { CUSTOM_TRANSFORMERS } from './customTransformers';
import { IMAGE } from './image';
import {
  E_BLOCK_EQUATION_NODE,
  E_INLINE_EQUATION_NODE,
  E_MULTILINE_BLOCK_EQUATION_NODE,
  I_EQUATION_NODE,
} from './katex';
import {
  E_CONTACT_MENTION,
  E_DATE_MENTION,
  E_DOCUMENT_MENTION,
  E_USER_MENTION,
  I_CONTACT_MENTION,
  I_DATE_MENTION,
  I_DOCUMENT_MENTION,
  I_USER_MENTION,
} from './mentions';
import { E_TABLE_NODE, I_TABLE_NODE } from './tables';
import {
  BR_TAG_TO_LINE_BREAK,
  HR,
  HTML_ENTITY_TRANSFORMERS,
  LINK_XML,
  MARK_XML,
  PRESERVE_LINES,
  SEARCH_MATCH,
} from './transformers';

/**
 * Internal transformers for converting markdown between Lexical state and markdown.
 * The internal format uses XML-based syntax to represent nodes that fall outside of
 * standard markdown syntax.
 */
export const INTERNAL_TRANSFORMERS: Transformer[] = [
  PRESERVE_LINES,
  LINK_XML, // Prefer internal xml link to handle []() in link text
  MARK_XML,
  SEARCH_MATCH,
  HR,
  IMAGE,
  I_USER_MENTION,
  I_DOCUMENT_MENTION,
  I_CONTACT_MENTION,
  I_DATE_MENTION,
  I_TABLE_NODE,
  I_EQUATION_NODE,
  ...CUSTOM_TRANSFORMERS,
];

/**
 * External transformers for converting Lexical to and from to GitHub Flavored (ish) Markdown.
 */
export const EXTERNAL_TRANSFORMERS: Transformer[] = [
  HR,
  MARK_XML,
  IMAGE,
  BR_TAG_TO_LINE_BREAK,
  E_TABLE_NODE,
  E_USER_MENTION,
  I_DOCUMENT_MENTION, // for chat attachments
  E_DOCUMENT_MENTION,
  E_CONTACT_MENTION,
  E_DATE_MENTION,
  // order matters
  E_MULTILINE_BLOCK_EQUATION_NODE,
  E_BLOCK_EQUATION_NODE,
  E_INLINE_EQUATION_NODE,
  ...HTML_ENTITY_TRANSFORMERS,
  ...CUSTOM_TRANSFORMERS,
];

/**
 * Complete set of transformers supporting both internal and external markdown operations.
 */
export const ALL_TRANSFORMERS: Transformer[] = [
  PRESERVE_LINES,
  LINK_XML, // Prefer internal xml link to handle []() in link text
  MARK_XML,
  SEARCH_MATCH,
  HR,
  IMAGE,
  BR_TAG_TO_LINE_BREAK,
  I_TABLE_NODE,
  E_TABLE_NODE,
  I_USER_MENTION,
  E_USER_MENTION,
  I_DOCUMENT_MENTION,
  E_DOCUMENT_MENTION,
  I_CONTACT_MENTION,
  E_CONTACT_MENTION,
  I_DATE_MENTION,
  E_DATE_MENTION,
  I_EQUATION_NODE,
  // order matters
  E_MULTILINE_BLOCK_EQUATION_NODE,
  E_BLOCK_EQUATION_NODE,
  E_INLINE_EQUATION_NODE,
  ...HTML_ENTITY_TRANSFORMERS,
  ...CUSTOM_TRANSFORMERS,
];
