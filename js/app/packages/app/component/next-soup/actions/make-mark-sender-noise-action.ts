import { markSenderNoiseWithToast } from '@queries/email/thread';
import { makeSenderFilterAction } from './make-sender-filter-action';

export const makeMarkSenderNoiseAction = () =>
  makeSenderFilterAction(markSenderNoiseWithToast);
