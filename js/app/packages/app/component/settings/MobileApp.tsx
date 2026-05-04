import AppStoreQr from '@macro-icons/app-store.svg';
import { Panel } from '@ui';

export function MobileApp() {
  return (
    <div
      class="flex-1 overflow-y-auto py-2 px-4"
      style="scrollbar-width: none;"
    >
      <div class="max-w-2xl w-full mx-auto">
        <Panel depth={2}>
          <div class="text-ink">
            <div class="relative flex items-center justify-between h-10 px-6 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-edge after:content-['']">
              <div class="text-sm font-semibold">Mobile App</div>
            </div>
            <div class="flex flex-col items-center justify-center gap-6 py-8">
              <AppStoreQr style="display: block; max-width: 300px;" />
              <p class="text-sm text-ink text-center">
                Download on the<br/>
                <a
                  href="https://apps.apple.com/us/app/macro-app/id6743133649"
                  rel="noopener noreferrer"
                  class="underline"
                  target="_blank"
                >
                  App Store
                </a>
              </p>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
