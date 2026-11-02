import { getPlatform } from '@core/util/platform';
import { perfMark } from './observability/perf-marks';

/** Load platform paint before mounting controls; inactive platforms get no rules. */
export async function loadPlatformStyles(platform = getPlatform()) {
  if (platform !== 'ios') return;
  perfMark('boot.platform-styles-start');
  await import('./components/app/mobile/glassPress.css');
  perfMark('boot.platform-styles-ready');
}
