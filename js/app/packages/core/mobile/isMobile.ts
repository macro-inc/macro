import { isMobileWidth } from './mobileWidth';
import { isTouchDevice } from './isTouchDevice';

/**
 * Returns true if the device is likely in a mobile context.
 * This checks for both a narrow screen width AND a primarily touch-based device.
 * Use this for behavior that should differ on phones vs tablets/desktops.
 */
export function isMobile(): boolean {
  return isMobileWidth() && isTouchDevice();
}
