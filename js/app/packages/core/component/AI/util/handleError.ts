import { toast } from '@core/component/Toast/Toast';
import { usePaywallState } from '@core/constant/PaywallState';
import type { StreamError } from '@service-cognition/websocket';

export function handleError(error: StreamError) {
  const { showPaywall } = usePaywallState();
  if (error.stream_error === 'payment_required') {
    showPaywall();
  } else {
    toast.failure('Failed to respond to message');
  }
}
