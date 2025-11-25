import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import {
  broadcastChannels,
  setBroadcastChannels,
} from '@app/signal/broadcastChannels';

const AUTH_CHANNEL = 'auth';
const LOGIN_SUCCESS = 'login-success';

/**
 * Gets or creates a broadcast channel for the authentication process.
 *
 * @returns The broadcast channel.
 */
export function getOrCreateAuthChannel(): BroadcastChannel {
  let channel = broadcastChannels().get(AUTH_CHANNEL);
  if (!channel) {
    channel = new BroadcastChannel(AUTH_CHANNEL);
    setBroadcastChannels(broadcastChannels().set(AUTH_CHANNEL, channel));
  }
  return channel;
}

export function waitForAuthSuccess(channel: BroadcastChannel): Promise<void> {
  return new Promise((resolve) => {
    channel.onmessage = (event) => {
      if (event.data.type === LOGIN_SUCCESS) {
        resolve();
      }
    };
  });
}

/** Errot type for a promise timing out. */
export type TimeoutError = { tag: 'TimeoutError'; message: string };

/**
 * Waits for the auth success message to be received on the given channel.
 *
 * @param channel The channel to wait for the message on.
 * @param timeout The timeout in milliseconds.
 * @returns A promise that resolves when the auth success message is received.
 */
export function waitForAuthSuccessOrTimeout(
  channel: BroadcastChannel,
  timeout: number
): ResultAsync<void, TimeoutError> {
  return new ResultAsync(
    new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve(
          errAsync({
            tag: 'TimeoutError',
            message: 'Timeout waiting for auth success',
          })
        );
      }, timeout);

      channel.onmessage = (event) => {
        if (event.data.type === LOGIN_SUCCESS) {
          clearTimeout(timeoutId);
          resolve(okAsync(undefined));
        }
      };
    })
  );
}

const AUTH_TIMEOUT = 10_000;
/**
 * Waits for the auth success message to be received on the channel.
 *
 * @returns A promise that resolves when the auth success message is received.
 */
export function authenticateWithEmailPermissions(): ResultAsync<
  void,
  TimeoutError
> {
  const channel = getOrCreateAuthChannel();
  return waitForAuthSuccessOrTimeout(channel, AUTH_TIMEOUT);
}
