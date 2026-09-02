import type { ConnectionState } from '../integration-ui';
import type { CapabilityStatus } from './model';

export function connectionState(status: CapabilityStatus): ConnectionState {
  switch (status) {
    case 'connected':
      return 'connected';
    case 'off':
      return 'off';
    case 'action-required':
      return 'attention';
    case 'not-connected':
      return 'disconnected';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function statusLabel(status: CapabilityStatus): string {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'off':
      return 'Off';
    case 'action-required':
      return 'Action required';
    case 'not-connected':
      return 'Not connected';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
