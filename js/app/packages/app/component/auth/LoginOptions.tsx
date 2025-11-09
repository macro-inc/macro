import { SERVER_HOSTS } from '@core/constant/servers';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import type { RedirectLocation } from '@core/util/authRedirect';
import IconApple from '@macro-icons/macro-apple.svg';
import IconGoogle from '@macro-icons/macro-google.svg';
import IconMail from '@macro-icons/macro-mail.svg';
import { useLocation } from '@solidjs/router';
import { type Setter, Show } from 'solid-js';
import { nativeAppleLogin } from '../settings/Mobile';
import { Stage } from './Shared';

export function LoginOptions(props: { setStage: Setter<Stage> }) {
  const location = useLocation<RedirectLocation>();
  const startSsoLogin = async (idp_name: string) => {
    const authUrl = new URL(`${SERVER_HOSTS['auth-service']}/login/sso`);
    authUrl.searchParams.set('idp_name', idp_name);
    if (isNativeMobilePlatform()) {
      authUrl.searchParams.set('is_mobile', 'true');
    }
    if (location.state?.originalLocation) {
      const { pathname, search, hash } = location.state.originalLocation;
      authUrl.searchParams.set(
        'original_url',
        `${window.location.origin}${pathname}${search}${hash}`
      );
    } else {
      authUrl.searchParams.set('original_url', window.location.href);
    }
    window.location.href = authUrl.toString();
  };

  return (
    <div class="grid select-none">
      <Show when={isNativeMobilePlatform() === 'ios'}>
        <div class="grid items-center justify-center p-5 border border-dashed border-ink border-t-0 [transition:color_var(--transition)] hover:text-accent hover:transition-none cursor-pointer">
          <a
            onClick={() => nativeAppleLogin()}
            class="grid grid-cols-[min-content_180px] gap-2.5 items-center justify-center"
          />
          <IconApple />
          <div class="whitespace-nowrap">Continue with Apple</div>
        </div>
      </Show>

      <div class="grid items-center justify-center p-5 border border-dashed border-ink border-t-0 [transition:color_var(--transition)] hover:text-accent hover:transition-none cursor-pointer">
        <a
          onClick={() => startSsoLogin('google')}
          class="grid grid-cols-[min-content_180px] gap-2.5 items-center justify-center"
        >
          <IconGoogle />
          <div class="whitespace-nowrap">Continue with Google</div>
        </a>
      </div>

      <Show when={!isNativeMobilePlatform()}>
        <div class="grid items-center justify-center p-5 border border-dashed border-ink border-t-0 [transition:color_var(--transition)] hover:text-accent hover:transition-none cursor-pointer">
          <a
            onClick={() => startSsoLogin('Apple')}
            class="grid grid-cols-[min-content_180px] gap-2.5 items-center justify-center"
          >
            <IconApple />
            <div class="whitespace-nowrap">Continue with Apple</div>
          </a>
        </div>
      </Show>

      <div class="grid items-center justify-center p-5 border border-dashed border-ink border-t-0 transition-colors duration-300 hover:text-accent hover:transition-none cursor-pointer">
        <a
          onClick={() => props.setStage(Stage.Email)}
          class="grid grid-cols-[min-content_180px] gap-2.5 items-center justify-center"
        >
          <IconMail />
          <div class="whitespace-nowrap">Continue with Email</div>
        </a>
      </div>

      <div class="p-5 border border-dashed border-[var(--color-ink)] border-t-0 text-center text-xs">
        By signing up, you agree to our
        <br />
        <a class="underline" href="/terms">
          terms
        </a>{' '}
        and{' '}
        <a class="underline" href="/privacy">
          privacy policy
        </a>
        .
      </div>
    </div>
  );
}
