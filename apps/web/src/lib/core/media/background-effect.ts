/** Camera effects shared by the waiting room and connected calls. */
export type BlurIntensity = 'light' | 'medium' | 'heavy';
export type BackgroundEffect =
  | { type: 'none' }
  | { type: 'blur'; intensity: BlurIntensity }
  | { type: 'image'; id: string; path: string };

export const BLUR_RADIUS: Record<BlurIntensity, number> = {
  light: 5,
  medium: 10,
  heavy: 20,
};

export function backgroundProcessorOptions(effect: BackgroundEffect) {
  if (effect.type === 'none') return { mode: 'disabled' as const };
  if (effect.type === 'blur')
    return {
      mode: 'background-blur' as const,
      blurRadius: BLUR_RADIUS[effect.intensity],
    };
  return { mode: 'virtual-background' as const, imagePath: effect.path };
}
