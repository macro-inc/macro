import { SiteHeader } from '../../../../../src/features/marketing/components/SiteHeader';
export const GRID_COLS =
  'minmax(0, 1fr) clamp(300px, 32vw, 420px) minmax(0, 1fr)';
export const GRID_GAP = '14px';
export function BaseHeader(_props: { ctaActive?: boolean }) {
  return <SiteHeader />;
}
