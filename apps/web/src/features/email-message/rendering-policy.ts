import { ENABLE_PROXY_EMAIL_IMAGES } from '@core/constant/featureFlags';
import { SERVER_HOSTS } from '@core/constant/servers';
import type { ImagePolicy } from '@macro-inc/email-renderer';

export const emailImagePolicy: ImagePolicy = {
  remote: 'allow',
  proxyUrl: ENABLE_PROXY_EMAIL_IMAGES
    ? `${SERVER_HOSTS['image-proxy-service']}/proxy`
    : undefined,
};
