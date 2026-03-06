import { toast } from '@core/component/Toast/Toast';
import type { ChatMessageStream } from '@service-connection/stream';

type Item = ReturnType<ChatMessageStream['data']>[number];
type StreamError = Extract<Item, { type: 'error' }>;

export function handleError(error: StreamError) {
  console.error(error);
  toast.failure('Failed to respond to message');
  // const { showPaywall } = usePaywallState();
  // if (error.error_type === "payment_required") {
  // 	showPaywall();
  // } else if (error.error_type === "model_context_overflow") {
  // 	toast.failure("Too much context. Remove attachments or start a new chat");
  // } else {
  // 	toast.failure("Failed to respond to message");
  // }
}
