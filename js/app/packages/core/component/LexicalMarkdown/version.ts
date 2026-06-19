/**
 * This constant is used for versioning the markdown documents to stable node sets.
 * Currently additional node types are causing data loss when an older editor (prod)
 * opens a document with newer node types (one created on staging). This file bumps and
 * documents the versions of the markdown editor. New nodes types should be integer bumps.
 *
 * Version 1.0 - July 18, 2025
 * Version 1.1 - August 7, 2025. Added scale support to media nodes.
 * Version 1.2 - Feb 3, 2026. Added theme-mention-node.
 * Version 1.21 - Feb 4, 2026. Added fallback-xml tag node.
 * Version 1.3 - Apr 30, 2026. Added AwaitNode.
 * Version 1.4 - Jun 2, 2026. Added persisted await placeholders for pending agent messages.
 * Version 2.0 - Jun 19, 2026. Added PullRequestMentionNode.
 */
export const MARKDOWN_VERSION_COUNTER = 2.0;
