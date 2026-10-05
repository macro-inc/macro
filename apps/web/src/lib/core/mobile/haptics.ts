import { impactFeedback } from '@tauri-apps/plugin-haptics';
import { isNativeMobilePlatform } from './isNativeMobilePlatform';

type ImpactStyle = Parameters<typeof impactFeedback>[0];

export function hapticImpact(style: ImpactStyle): void {
  if (!isNativeMobilePlatform()) return;
  void performImpact(style);
}

async function performImpact(style: ImpactStyle) {
  try {
    await impactFeedback(style);
  } catch {
    // Haptics are optional on tablets and devices without a vibrator.
  }
}
