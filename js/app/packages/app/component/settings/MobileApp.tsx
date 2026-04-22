import AppStoreQr from '@macro-icons/app-store.svg';

export function MobileApp() {
  return (
    <div class="h-full flex flex-col items-center justify-center gap-6">
      <AppStoreQr class="w-[50cqw] h-[50cqw] text-accent" />
      <p class="text-lg text-ink font-medium">Download on the App Store</p>
    </div>
  );
}
