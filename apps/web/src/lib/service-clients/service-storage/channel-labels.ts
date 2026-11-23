import type { dssFetch } from './client';
import type { ChannelLabel } from './generated/schemas/channelLabel';
import type { ChannelLabelRule } from './generated/schemas/channelLabelRule';
import type { ChannelLabelScopeSelection } from './generated/schemas/channelLabelScopeSelection';
import type { ChannelLabelsList } from './generated/schemas/channelLabelsList';
import type { CreateChannelLabelRequest } from './generated/schemas/createChannelLabelRequest';
import type { RenameChannelLabelRequest } from './generated/schemas/renameChannelLabelRequest';
import type { SetChannelLabelRequest } from './generated/schemas/setChannelLabelRequest';
import type { SmartTagPreview } from './generated/schemas/smartTagPreview';

/** The additive sections API shares DTOs, not legacy membership semantics. */
export function createChannelLabelsClient(
  fetch: typeof dssFetch,
  basePath: '/channel-labels' | '/channel-sections'
) {
  return {
    async preview(
      rule: ChannelLabelRule,
      signal?: AbortSignal,
      scope?: ChannelLabelScopeSelection
    ) {
      return await fetch<SmartTagPreview>(
        `${basePath}/preview${scope ? `?scope=${scope}` : ''}`,
        { method: 'POST', body: JSON.stringify(rule), signal }
      );
    },
    /** Omitted scope selects the caller's team when available, otherwise personal labels. */
    async list(scope?: ChannelLabelScopeSelection) {
      return await fetch<ChannelLabelsList>(
        `${basePath}${scope ? `?scope=${scope}` : ''}`
      );
    },
    async create(
      params: CreateChannelLabelRequest,
      scope?: ChannelLabelScopeSelection
    ) {
      return await fetch<ChannelLabel>(
        `${basePath}${scope ? `?scope=${scope}` : ''}`,
        { method: 'POST', body: JSON.stringify(params) }
      );
    },
    async rename(
      labelId: string,
      params: RenameChannelLabelRequest,
      scope?: ChannelLabelScopeSelection
    ) {
      return await fetch<ChannelLabel>(
        `${basePath}/${encodeURIComponent(labelId)}${scope ? `?scope=${scope}` : ''}`,
        { method: 'PATCH', body: JSON.stringify(params) }
      );
    },
    async remove(labelId: string, scope?: ChannelLabelScopeSelection) {
      return await fetch(
        `${basePath}/${encodeURIComponent(labelId)}${scope ? `?scope=${scope}` : ''}`,
        { method: 'DELETE' }
      );
    },
    async setChannelLabel(
      channelId: string,
      params: SetChannelLabelRequest,
      scope?: ChannelLabelScopeSelection
    ) {
      return await fetch(
        `${basePath}/channels/${encodeURIComponent(channelId)}${scope ? `?scope=${scope}` : ''}`,
        { method: 'PUT', body: JSON.stringify(params) }
      );
    },
  };
}
