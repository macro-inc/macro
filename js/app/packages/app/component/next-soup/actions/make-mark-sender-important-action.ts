import { markSenderSignalWithToast } from '@queries/email/thread';
import { makeSenderFilterAction } from './make-sender-filter-action';

export const makeMarkSenderSignalAction = () =>
  makeSenderFilterAction(markSenderSignalWithToast);
