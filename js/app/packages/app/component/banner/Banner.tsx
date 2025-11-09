import { LoginButton } from '@core/component/TopBar/LoginButton';

export default function Banner() {
  return (
    <div class="fixed bottom-0 md:bottom-12 md:left-1/2 md:-translate-x-1/2 z-sign-up-banner flex md:flex-row flex-col justify-baseline items-center gap-2 md:gap-10 bg-dialog shadow-2xl p-3 md:p-2 border border-edge w-full md:w-auto text-ink text-center whitespace-nowrap">
      <span class="font-semibold">Create an account to get started.</span>
      <LoginButton />
    </div>
  );
}
