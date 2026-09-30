import { notificationServiceClient } from '@service-notification/client';
import { fetchUserInfo } from '../auth/user-info';

type Device = { deviceType: 'android' | 'ios'; token: string };

export function registerPushDevice(device: Device) {
  return notificationServiceClient.registerDevice(device);
}

export function unregisterPushDevice(device: Device) {
  return notificationServiceClient.unregisterDevice(device);
}

export async function fetchPushRecipient() {
  return (await fetchUserInfo()).userId;
}
