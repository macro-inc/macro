import { LoginButton } from '@core/component/TopBar/LoginButton';
import { Surface } from '@ui';

export default function Banner() {
  return (
    <div class="fixed bottom-0 md:bottom-12 md:left-1/2 md:-translate-x-1/2 z-sign-up-banner w-full md:w-auto">
      <Surface>
        <div class="flex md:flex-row flex-col justify-baseline items-center gap-2 md:gap-6 p-2 text-ink text-center whitespace-nowrap">
          <span class="text-sm text-ink-muted px-2">
            Create an account to get started.
          </span>
          <LoginButton />
        </div>
      </Surface>
    </div>
  );
}
