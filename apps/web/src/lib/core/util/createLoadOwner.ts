import { onCleanup } from 'solid-js';

export interface OwnedLoad<T> {
  /** Retired reads never expose their resource, including during publication. */
  readonly value: T | undefined;
  /** Transfer cleanup to the mounted consumer. */
  adopt(): T | undefined;
}

/** Own resources across parallel reads and module evaluation until adoption. */
export function createLoadOwner() {
  let current: { retire: () => void } | undefined;
  const invalidate = () => {
    current?.retire();
    current = undefined;
  };
  onCleanup(invalidate);
  return {
    invalidate,
    async run<T>(
      load: () => Promise<T>,
      dispose: (value: T) => void,
      ready?: () => Promise<unknown>
    ): Promise<OwnedLoad<T> | undefined> {
      invalidate();
      let retired = false;
      let cleanup: (() => void) | undefined;
      const owner = {
        retire() {
          if (retired) return;
          retired = true;
          cleanup?.();
          cleanup = undefined;
        },
      };
      current = owner;
      const read = async () => {
        const value = await load();
        if (retired) dispose(value);
        else cleanup = () => dispose(value);
        return value;
      };
      try {
        const [value] = await Promise.all([read(), ready?.()]);
        if (retired) return;
        return {
          get value() {
            return retired ? undefined : value;
          },
          adopt() {
            if (retired) return;
            cleanup = undefined;
            if (current === owner) current = undefined;
            return value;
          },
        };
      } catch (error) {
        owner.retire();
        if (current === owner) current = undefined;
        throw error;
      }
    },
  };
}
