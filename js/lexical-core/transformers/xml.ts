import { I_AWAIT_NODE } from './await';
import { I_MACRO_QUOTE } from './classedBlock';
import { CUSTOM_TRANSFORMERS } from './customTransformers';
import { I_IMAGE_CONSTRAINED, IMAGE } from './image';
import {
  I_EQUATION_NODE,
} from './katex';
import {
  I_CONTACT_MENTION,
  I_DATE_MENTION,
  I_DOCUMENT_CARD,
  I_DOCUMENT_MENTION,
  I_GROUP_MENTION,
  I_THEME_MENTION,
  I_USER_MENTION,
} from './mentions';
import { I_SNAPSHOT_NODE } from './snapshot';
import { I_TABLE_NODE } from './tables';
import {
  HR,
  LINK_XML,
  MARK_XML,
  PRESERVE_LINES,
  SEARCH_MATCH,
} from './transformers';
import { UNKNOWN_MENTION } from './unknownMention';
import { I_VIDEO } from './video';
import { I_WATERMARK } from './watermark';

export const XML_TRANSFORMERS = [
  I_SNAPSHOT_NODE, // Must be before mentions to avoid matching inner tags in snapshot content
  PRESERVE_LINES,
  LINK_XML, // Prefer internal xml link to handle []() in link text
  MARK_XML,
  SEARCH_MATCH,
  HR,
  I_VIDEO,
  I_IMAGE_CONSTRAINED,
  IMAGE, // Standard markdown images (fallback)
  I_USER_MENTION,
  I_GROUP_MENTION,
  I_DOCUMENT_MENTION,
  I_DOCUMENT_CARD,
  I_CONTACT_MENTION,
  I_DATE_MENTION,
  I_AWAIT_NODE,
  I_TABLE_NODE,
  I_MACRO_QUOTE,
  I_EQUATION_NODE,
  I_THEME_MENTION,
  I_WATERMARK,
  ...CUSTOM_TRANSFORMERS,
  UNKNOWN_MENTION, // Must be last to act as fallback for unrecognized XML tags
];
