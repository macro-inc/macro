import {
  useMetaReply,
  useMetaTemplates,
  useMetaUpload,
} from '@queries/meta-messaging';
import type { ReplySource } from '../context/reply-source';

/** Existing clients retain request formats, cache invalidation and query ownership. */
export function createReplySource(channelId: string): ReplySource {
  const reply = useMetaReply(() => channelId);
  const upload = useMetaUpload(() => channelId);
  return {
    send: (request) => reply.mutateAsync(request),
    isSending: () => reply.isPending,
    upload: (file) => upload.mutateAsync(file),
    isUploading: () => upload.isPending,
    templates: (enabled) => {
      const query = useMetaTemplates(() => channelId, enabled);
      return {
        items: () =>
          query.isSuccess
            ? (query.data ?? []).map((template) => ({
                id: template.id,
                name: template.name,
                language: template.language,
                parameter_labels: template.parameter_labels,
                unsupported_reason: template.unsupported_reason,
                preview: templatePreview(template.components),
              }))
            : [],
        ready: () => query.isSuccess,
        failed: () => query.isError,
        refresh: () => query.refetch(),
      };
    },
  };
}

function templatePreview(components: unknown): string {
  if (!Array.isArray(components)) return '';
  return components
    .flatMap((part: unknown) =>
      part &&
      typeof part === 'object' &&
      'text' in part &&
      typeof part.text === 'string'
        ? [part.text]
        : []
    )
    .join('\n');
}
