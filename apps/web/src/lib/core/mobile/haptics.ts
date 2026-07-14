import { isTauri } from '@tauri-apps/api/core';
import { impactFeedback } from '@tauri-apps/plugin-haptics';

type ImpactStyle = Parameters<typeof impactFeedback>[0];

export function hapticImpact(style: ImpactStyle): void {
  if (!isTauri()) return;
  void impactFeedback(style);
}
