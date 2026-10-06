import { queryClient } from '@queries/client';
import { cognitionApiServiceClient } from '@service-cognition/client';
import type { BookingLinkArgs } from '../core/booking-link';
import { schedulingKeys } from './keys';

export type BookingReviewIdentity = {
  chat_id: string;
  messageId: string;
  toolCallId: string;
};
export const executeBookingReview = (
  identity: BookingReviewIdentity,
  args: BookingLinkArgs
) =>
  cognitionApiServiceClient.callTool<'CreateBookingLink' | 'EditBookingLink'>({
    ...identity,
    args,
  });
export const persistBookingReview = (
  identity: BookingReviewIdentity,
  args: BookingLinkArgs
) =>
  cognitionApiServiceClient.updateToolCall<
    'CreateBookingLink' | 'EditBookingLink'
  >({ ...identity, args });
export const rejectBookingReview = (identity: BookingReviewIdentity) =>
  cognitionApiServiceClient.rejectToolCall(identity);
export const invalidateBookingLinks = () =>
  queryClient.invalidateQueries({ queryKey: schedulingKeys._def });
