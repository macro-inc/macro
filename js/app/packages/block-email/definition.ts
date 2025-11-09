import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { DEFAULT_THREAD_MESSAGES_LIMIT } from '@core/constant/pagination';
import { isErr, ok } from '@core/util/maybeResult';
import { emailClient } from '@service-email/client';
import EmailBlock from './component/Block';

export const definition = defineBlock({
  name: 'email',
  description: 'View and manage email threads',
  component: EmailBlock,
  liveTrackingEnabled: true,
  syncServiceEnabled: false,

  async load(source) {
    if (source.type === 'dss') {
      let email = await emailClient.getThread({
        thread_id: source.id,
        offset: 0,
        limit: DEFAULT_THREAD_MESSAGES_LIMIT,
      });

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
