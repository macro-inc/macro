import AppStoreQr from '@macro-icons/app-store.svg';
import { Panel } from '@ui';

export function MobileApp() {
  return (
    <div
      class="h-full overflow-hidden flex justify-center p-2"
    >
      <div class="max-w-200 w-full h-full">
        <Panel depth={2} class="h-full overflow-hidden text-ink">
          <Panel.Header class="px-6">
            <div class="text-sm font-semibold">Mobile App</div>
          </Panel.Header>
          <Panel.Body class="flex flex-col items-center justify-center gap-6 py-8">
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
          </Panel.Body>
        </Panel>
      </div>
    </div>
  );
}
