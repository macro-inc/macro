import { datadogRum } from '@datadog/browser-rum';
import { isInitialized } from './shared';

export function startAction(name: string, context?: object) {
  if (!isInitialized()) return;

  datadogRum.addAction(name, context);
}
