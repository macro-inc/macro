import { onMount } from 'solid-js';
import { DesktopHandoff } from '../components/desktop-handoff';
import { OnboardingShell } from '../components/onboarding-shell';
import { useOnboardingContext } from '../context/onboarding-context';

/**
 * After a phone-browser onboarding completes: point at desktop and the app
 * before entering the app here.
 */
export function DesktopHandoffView(props: {
  storeUrl: string;
  onContinue: () => void;
}) {
  const context = useOnboardingContext();
  onMount(() =>
    context.track('onboarding_v4_desktop_handoff', { action: 'viewed' })
  );
  return (
    <OnboardingShell>
      <DesktopHandoff
        storeUrl={props.storeUrl}
        onDownloadApp={() =>
          context.track('onboarding_v4_desktop_handoff', {
            action: 'download_app',
          })
        }
        onContinue={() => {
          context.track('onboarding_v4_desktop_handoff', {
            action: 'continue_in_browser',
          });
          props.onContinue();
        }}
      />
    </OnboardingShell>
  );
}
