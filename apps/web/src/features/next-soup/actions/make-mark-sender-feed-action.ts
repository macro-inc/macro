import { markSenderFeedWithToast } from '@queries/email/thread';
import { makeSenderFilterAction } from './make-sender-filter-action';

export const makeMarkSenderFeedAction = () =>
  makeSenderFilterAction(markSenderFeedWithToast);
