import { isPlatform } from '@core/util/platform';
import { getVersion } from '@tauri-apps/api/app';
import { createResource } from 'solid-js';
import { DesktopAppDownload, DesktopAppInfo } from './components/desktop-app';

/** Native APIs are only read when mounted inside the desktop app. */
export function DesktopApp() {
  if (!isPlatform('desktop')) return <DesktopAppDownload />;

  const [version] = createResource(async () => {
    try {
      return await getVersion();
    } catch {
      return 'Not available';
    }
  });
  const buildTime = import.meta.env.__APP_BUILD_TIME__;
  const buildDate =
    buildTime && Number.isFinite(buildTime) && buildTime > 0
      ? new Date(buildTime)
      : undefined;

  return (
    <DesktopAppInfo
      version={version.loading ? 'Loading…' : (version() ?? 'Not available')}
      buildDate={buildDate}
    />
  );
}
