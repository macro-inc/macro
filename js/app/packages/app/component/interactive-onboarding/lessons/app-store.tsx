import { onMount } from 'solid-js';
import AppStoreQr from '@macro-icons/app-store.svg';
import type { LessonContentProps, LessonDefinition } from '../types';

function AppStoreContent(props: LessonContentProps) {
  onMount(() => props.onComplete());
  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <p>
        Scan the QR code to download the Macro iOS app and take it on the go.
      </p>
      <p>This QR code is always available in the settings panel.</p>
    </div>
  );
}

function AppStoreDemo() {
  return (
    <div class="h-full w-full flex items-center justify-center px-8 @container">
      <div class="h-full w-full flex flex-col items-center justify-center gap-6">
        <AppStoreQr class="w-[50cqw] h-[50cqw] text-accent" />
        <p class="text-ink font-medium">Download on the App Store</p>
      </div>
    </div>
  );
}

export const appStoreLesson: LessonDefinition = {
  id: 'app-store',
  title: 'Get the iOS app',
  subtitle: 'Take Macro on the go',
  content: AppStoreContent,
  demo: AppStoreDemo,
  centeredButton: true,
  order: 90,
};
