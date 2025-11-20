import { withAnalytics } from '@coparse/analytics';
import { useOrganization } from '@core/user';
import { isErr } from '@core/util/maybeResult';
import { gqlServiceClient, updateUserInfo } from '@service-gql/client';
import { detect } from 'detect-browser';
import type { JSX } from 'solid-js';
import { createSignal, onMount, Show } from 'solid-js';

const { track, identify, TrackingEvents } = withAnalytics();

export function setCookie(name: string, value: string, days: number) {
  const expires = days
    ? `; expires=${new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString()}`
    : '';
  document.cookie = `${name}=${encodeURIComponent(value)}${expires}; path=/`;
}

export const LOGIN_COOKIE_AGE = 2592000; // 1 month in seconds

export const identifyUser = async () => {
  // NOTE: organization is a singleton so this is ok for now
  const [, { refetch: refetchOrganization }] = useOrganization();
  await refetchOrganization();

  const userInfoResult = await updateUserInfo();

  if (userInfoResult && isErr(userInfoResult)) return;
  const userInfo = userInfoResult ? userInfoResult[1] : null;
  if (!userInfo) {
    return;
  }

  const platform = detect(navigator.userAgent);
  track(TrackingEvents.AUTH.LOGIN);
  if (userInfo?.id) {
    identify(userInfo.id, {
      email: userInfo?.email,
      os: `${platform?.os?.replaceAll(' ', '')}`,
    });
  }
};

export const assignABGroup = async () => {
  const randomGroup = Math.random() < 0.5 ? 'A' : 'B';
  gqlServiceClient.setGroup({ group: randomGroup });
  return randomGroup;
};

export enum Stage {
  Verify = 'verify',
  Email = 'email',
  Done = 'done',
  None = 'none',
}

export function Input(props: {
  onInput?: JSX.ChangeEventHandlerUnion<HTMLInputElement, Event>;
  inputMode?: 'text' | 'numeric';
  textCenter?: boolean;
  placeholder?: string;
  readOnly?: boolean;
  required?: boolean;
  value?: string;
  type?: string;
  id: string;
}) {
  const [el, setEl] = createSignal<HTMLInputElement>();
  onMount(() => {
    setTimeout(() => {
      el()?.focus();
    }, 1);
  });
  return (
    <input
      class={`appearance-none disabled:bg-edge/70 block w-full shadow-none placeholder-placeholder sm:text-sm ${props.textCenter ? 'text-center' : ''}`}
      required={props.required ?? true}
      placeholder={props.placeholder}
      type={props.type || 'text'}
      inputMode={props.inputMode}
      readOnly={props.readOnly}
      value={props.value ?? ''}
      onInput={props.onInput}
      autocomplete={props.id}
      name={props.id}
      id={props.id}
      ref={setEl}
    />
  );
}

export function ErrorMsg(props: { msg?: string }) {
  return (
    <Show when={props.msg}>
      <div class="grid items-center justify-center p-5 border border-dashed border-ink border-t-0">
        {props.msg}
      </div>
    </Show>
  );
}
