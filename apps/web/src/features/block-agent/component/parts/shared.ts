/**
 * Shared vocabulary for the per-part components, mirroring the chat block's
 * tool-handler split (`@core/component/AI/component/tool/handler.tsx`): each
 * detail kind renders in its own file, and the dispatcher passes the
 * row-level facts every card shares.
 */

import type { ToolName } from '@service-agent-fold/generated/types';
import type { JSX } from 'solid-js';
import type { ToolStatus } from '../../ui';

/** Row-level facts common to every tool card, derived once by the dispatcher. */
export type ToolCallCommon = {
  /** The ACP tool call id. */
  id: string;
  label: string;
  status: ToolStatus;
  /** The chat block's failed treatment: faded row, quiet trailing label. */
  muted: boolean;
  trailing: JSX.Element | undefined;
};

/**
 * The short name to show for a tool: its own name, without the MCP server
 * namespace the fold already separated out.
 */
export function toolLabel(name: ToolName): string {
  return name.kind === 'mcp' ? name.tool : name.name;
}

/** Subtitle for a call that touched paths: the path, or how many. */
export function pathsSubtitle(paths: string[]): string | undefined {
  if (paths.length === 0) return undefined;
  if (paths.length === 1) return paths[0];
  return `${paths.length} files`;
}
