import type { LoroManager } from '@macro-inc/collaboration/collab/manager';
import type { LiveSyncSource } from '@macro-inc/collaboration/collab/source';
import type { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import type { Accessor } from 'solid-js';

/** Session ownership is independent of whether the host is a block or a native view. */
export type CollabMarkdownSession = {
  loroManager: LoroManager<typeof MARKDOWN_LORO_SCHEMA>;
  syncSource: Accessor<LiveSyncSource | undefined>;
  connectionError: Accessor<string | undefined>;
};
