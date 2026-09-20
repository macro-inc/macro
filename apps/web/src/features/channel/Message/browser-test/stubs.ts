import { useMutation } from '@tanstack/solid-query';

/** Network and app-session adapters; rendering, unfurl batching and scrolling are real. */
export const useUserId = () => () => 'fixture-user';
type Removal = { channelID: string; messageID: string; url: string };
export const useRemoveLinkPreviewMutation = (callbacks: {
  onError?: (error: Error, variables: Removal) => void;
}) =>
  useMutation(() => ({
    mutationFn: async (variables: Removal) => {
      const response = await fetch('/__remove-preview', {
        method: 'PATCH',
        body: JSON.stringify(variables),
      });
      if (!response.ok) throw new Error('Preview removal failed');
    },
    onError: callbacks.onError,
  }));
export const openExternalUrl = () => {};
export const extractDomain = (url: string) => new URL(url).hostname;
export const getWebOrigin = () => window.location.origin;
export const cn = (...classes: (string | undefined | false)[]) =>
  classes.filter(Boolean).join(' ');
export const proxyResource = (url: string) => url;
export const UnfurlServiceClient = {
  async unfurlBulk(input: { url_list: string[] }) {
    const response = await fetch('/__unfurl', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (!response.ok)
      return { isErr: () => true as const, value: { responses: [] } };
    return { isErr: () => false as const, value: await response.json() };
  },
};

export const isOwnMessage = (
  message: { sender_id: string },
  userId: string | undefined
) => message.sender_id === userId;
