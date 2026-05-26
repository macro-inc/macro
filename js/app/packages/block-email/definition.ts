import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { fetchAndCacheThread } from '@queries/email/thread';
import { ok } from 'neverthrow';
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

      if (email.isErr()) {
        if (email.error.some((error) => error.code === 'NOT_FOUND')) {
          return LoadErrors.MISSING;
        } else if (
          email.isErr() &&
          email.error.some((error) => error.code === 'UNAUTHORIZED')
        ) {
          return LoadErrors.UNAUTHORIZED;
        } else if (
          email.isErr() &&
          email.error.some((error) => error.code === 'GONE')
        ) {
          return LoadErrors.GONE;
        } else {
          return LoadErrors.INVALID;
        }
      }

      const emailData = email.value;

      return ok({
        ...emailData,
      });
    }
    return LoadErrors.INVALID;
  },
  accepted: {},
});

export type EmailData = ExtractLoadType<(typeof definition)['load']>;
