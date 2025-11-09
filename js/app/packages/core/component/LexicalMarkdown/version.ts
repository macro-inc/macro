/**
 * This constant is used for versioning the markdown documents to stable node sets.
 * Currently additional node types are causing data loss when an older editor (prod)
 * opens a document with newer node types (one created on staging). This file bumps and
 * documents the versions of the markdown editor. New nodes types should be integer bumps.
 *
 * Version 1.0 - July 18, 2025
 * Version 1.1 - August 7, 2025. Added scale support to media nodes.
 */
export const MARKDOWN_VERSION_COUNTER = 1.1;

export const STAGING_TAG = 'staging';
