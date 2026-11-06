import { notificationServiceClient } from '@service-notification/client';
import type { DeviceRequest } from '@service-notification/generated/schemas/deviceRequest';
import { fetchUserInfo } from '../auth/user-info';

type Device = DeviceRequest & {
  deviceType: 'android' | 'ios';
};

export function registerPushDevice(device: Device) {
  return notificationServiceClient.registerDevice(device);
}

export function unregisterPushDevice(device: Device) {
  return notificationServiceClient.unregisterDevice(device);
}

export async function fetchPushRecipient() {
  return (await fetchUserInfo()).userId;
}
