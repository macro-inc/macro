import { SERVER_HOSTS } from '@core/constant/servers';
import { isErr } from '@core/util/maybeResult';
import ArrowLeft from '@icon/regular/arrow-left.svg';
import ArrowRight from '@icon/regular/arrow-right.svg';
import { authServiceClient } from '@service-auth/client';
import { createCallback } from '@solid-primitives/rootless';
import { action, useSearchParams, useSubmission } from '@solidjs/router';
import { platformFetch } from 'core/util/platformFetch';
import {
  createEffect,
  createSignal,
  type Setter,
  Show,
  untrack,
} from 'solid-js';
import { ErrorMsg, Input, Stage } from './Shared';

// Construct the redirect uri to use for passwordless login.
// This will send us back to the application after clicking the magic link.
// in "dev" (local) we use http otherwise https
const protocol = import.meta.hot ? 'http' : 'https';
const REDIRECT_URI = `${protocol}://${window.location.host}/app`;

async function isPasswordLogin(email?: string | null) {
  if (!email) return false;

  const encodedEmail = new TextEncoder().encode(email.toLowerCase());
  const hashedBuffer = await crypto.subtle.digest('SHA-256', encodedEmail);
  const hashedEmail = Array.from(new Uint8Array(hashedBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return (
    hashedEmail ===
    '0d10222b5594dbb0eb5d2bccbc9b5d8e9ff83e99421b573fb32c8a7b74491c81'
  );
}

// Initiates the passwordless login flow.
// Redirecting to the requested identity provider endpoint.
export const sendEmailCode = action(async (formData: FormData) => {
  const email = formData.get('email');
  if (!email || typeof email !== 'string') throw new Error('Invalid email');

  if (typeof email === 'string' && (await isPasswordLogin(email))) {
    const password = formData.get('password');
    if (!password || typeof password !== 'string') return 'isPasswordLogin';

    const maybeTokens = await authServiceClient.passwordLogin({
      password,
      email,
    });
    if (isErr(maybeTokens))
      throw new Error(
        'Failed to login. Check your email and password then try again.'
      );

    return 'LoggedIn';
  }

  const response = await platformFetch(
    `${SERVER_HOSTS['auth-service']}/login/passwordless`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        redirect_uri: REDIRECT_URI,
        email,
      }),
    }
  );

  if (!response.ok) throw new Error(await response.text());

  // If the passwordless call returns 202,
  // the email needs to login through a dedicated identity provider.
  if (response.status === 202) {
    const body = await response.json();
    const idp_id = body.idp_id;
    // form dumb
    const urlEncodedEmail = encodeURIComponent((email ?? '').toString());
    window.location.href = `${SERVER_HOSTS['auth-service']}/login/sso?idp_id=${idp_id}&login_hint=${urlEncodedEmail}`;
    return false; // passwordless login flow is not reached
  }

  return true;
}, 'passwordless-login');

export function useResetEmailCode(setStage: Setter<Stage>) {
  const submission = useSubmission(sendEmailCode);
  return createCallback(() => {
    submission.clear();
    setStage(Stage.Email);
  });
}

export function EmailForm(props: { setStage: Setter<Stage> }) {
  const [isPasswordLogin, setIsPasswordLogin] = createSignal(false);
  const submission = useSubmission(sendEmailCode);
  const [searchParams] = useSearchParams();
  const searchParamsEmail = untrack(() => {
    const email = searchParams.email;
    if (typeof email === 'string') return email;
  });

  createEffect(() => {
    if (submission.result === true) {
      props.setStage(Stage.Verify);
    } else if (submission.result === 'isPasswordLogin') {
      setIsPasswordLogin(true);
    } else if (submission.result === 'LoggedIn') {
      props.setStage(Stage.Done);
    }
  });

  const handleBack = createCallback(() => {
    submission.clear();
    props.setStage(Stage.None);
  });

  return (
    <div class="grid select-none">
      <form action={sendEmailCode} method="post" class="m-0">
        <div class="flex items-center justify-center text-center py-5 px-10 border border-dashed border-ink border-t-0">
          <Input
            value={searchParamsEmail}
            placeholder="Email Address"
            type="email"
            id="email"
          />
        </div>

        <Show when={isPasswordLogin()}>
          <div class="grid items-center justify-center p-5 border border-dashed border-ink border-t-0 [transition:color_var(--transition)] hover:text-accent hover:transition-none cursor-pointer">
            <Input
              required={isPasswordLogin()}
              placeholder="Password"
              type="password"
              id="password"
            />
          </div>
        </Show>

        <div class="border border-dashed border-ink border-t-0 py-5 px-10 flex flex-none justify-between items-center">
          <button
            class="hover:text-accent hover:transition-none cursor-pointer transition-colors duration-300 grid grid-cols-[min-content_min-content] items-center w-min"
            onClick={handleBack}
            type="button"
          >
            <ArrowLeft class="w-5 h-5" />
            <span>Back</span>
          </button>

          <button
            class="hover:text-accent hover:transition-none cursor-pointer transition-colors duration-300 grid grid-cols-[min-content_min-content] items-center w-min"
            type="submit"
            disabled={submission.pending}
          >
            <span>Continue</span>
            <ArrowRight class="w-5 h-5" />
          </button>
        </div>
        <ErrorMsg msg={submission.error?.message} />
      </form>
    </div>
  );
}
