import { notificationServiceClient } from '@service-notification/client';
import type { DeviceType } from '@service-notification/generated/schemas/deviceType';

// The 'iosvoip' variant exists in the backend but the generated schema has not been
// regenerated to include it yet. Cast until a regeneration picks it up.
const DEVICE_TYPE_IOS_VOIP = 'iosvoip' as DeviceType;

export function registerVoipDevice(token: string) {
  return notificationServiceClient.registerDevice({
    token,
    deviceType: DEVICE_TYPE_IOS_VOIP,
  });
}

export function unregisterVoipDevice(token: string) {
  return notificationServiceClient.unregisterDevice({
    token,
    deviceType: DEVICE_TYPE_IOS_VOIP,
  });
}
