import { SERVER_HOSTS } from '@core/constant/servers';

export const WEBHOOK_TOKEN_HEADER = 'x-macro-channel-bot-token';

export function channelWebhookUrl(channelId: string): string {
  return `${SERVER_HOSTS['document-storage-service']}/channels/${channelId}/webhook`;
}

export function webhookExample(url: string, token: string): string {
  return [
    `curl -X POST '${url}' \\`,
    `  -H '${WEBHOOK_TOKEN_HEADER}: ${token}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '{"content":"Hello from your bot"}'`,
  ].join('\n');
}
