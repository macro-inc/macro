import { SERVER_HOSTS } from '@core/constant/servers';

export function proxyResource(url: string) {
  return `${SERVER_HOSTS['unfurl-service']}/proxy?url=${url}`;
}
