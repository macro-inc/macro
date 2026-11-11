import { getVersion } from '@tauri-apps/api/app';
import { createResource } from 'solid-js';
import { appBuildDate, getBundleDebugInfo, otaBundleDate } from './app-build';
import { AppInfo } from './components/app-info';

/** Mount only inside the native app; reads version and bundle info over IPC. */
export function NativeAppInfo(props: { title: string; description: string }) {
  const [version] = createResource(async () => {
    try {
      return await getVersion();
    } catch {
      return 'Not available';
    }
  });
  const [bundleInfo] = createResource(getBundleDebugInfo);

  return (
    <AppInfo
      title={props.title}
      description={props.description}
      version={version.loading ? 'Loading…' : (version() ?? 'Not available')}
      buildDate={appBuildDate()}
      bundleDate={otaBundleDate(bundleInfo())}
    />
  );
}
