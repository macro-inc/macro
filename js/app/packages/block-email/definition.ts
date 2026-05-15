import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { isErr, ok } from '@core/util/maybeResult';
import { fetchAndCacheThread } from '@queries/email/thread';
import EmailBlock from './component/Block';

export const definition = defineBlock({
  name: 'email',
  description: 'View and manage email threads',
  component: EmailBlock,
  liveTrackingEnabled: true,
  syncServiceEnabled: false,
  defaultFilename: '[No subject]',

  async load(source) {
    if (source.type === 'dss') {
      let email = await fetchAndCacheThread(source.id);

      if (!email) {
        return LoadErrors.MISSING;
      }

      if (isErr(email)) {
        if (isErr(email, 'MISSING')) {
          return LoadErrors.MISSING;
        } else if (isErr(email, 'UNAUTHORIZED')) {
          return LoadErrors.UNAUTHORIZED;
        } else if (isErr(email, 'GONE')) {
          return LoadErrors.GONE;
        } else {
          return LoadErrors.INVALID;
        }
      }

      const [, emailData] = email;

      return ok({
        ...emailData,
      });
    }
    return LoadErrors.INVALID;
  },
  accepted: {},
});

export type EmailData = ExtractLoadType<(typeof definition)['load']>;
