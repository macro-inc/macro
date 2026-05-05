import AppStoreQr from '@macro-icons/app-store.svg';
import { Panel } from '@ui';

export function MobileApp() {
  return (
    <div
      class="h-full overflow-hidden flex justify-center p-2"
    >
      <div class="max-w-200 w-full h-full">
        <Panel depth={2} class="h-full overflow-hidden">
          <div class="text-ink h-full flex flex-col">
            <div class="flex items-center justify-between h-10 px-6 border-b border-edge-muted">
              <div class="text-sm font-semibold">Mobile App</div>
            </div>
            <div class="flex-1 flex flex-col items-center justify-center gap-6 py-8">
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
