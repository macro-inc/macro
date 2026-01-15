import { logger } from '@observability/logger';
import { createContext, type ParentProps, useContext } from 'solid-js';
import {
  createEmailFormState,
  type EmailFormStateOptions,
} from './createEmailFormState';

type EmailFormContextValue = ReturnType<typeof createEmailFormState>;

type RegistryApi = {
  getOrInit: (key: string) => EmailFormContextValue;
};

const EmailFormRegistryCtx = createContext<RegistryApi>();

export function EmailFormContextProvider(
  props: ParentProps<{ formOptions: EmailFormStateOptions }>
) {
  const map = new Map<string, EmailFormContextValue>();

  const getOrInit: RegistryApi['getOrInit'] = (key) => {
    if (!key) {
      logger.error('Key is required');
    }
    let existing = map.get(key);
    if (!existing) {
      existing = createEmailFormState(key, props.formOptions);
      map.set(key, existing);
    }
    return existing;
  };

  return (
    <EmailFormRegistryCtx.Provider value={{ getOrInit }}>
      {props.children}
    </EmailFormRegistryCtx.Provider>
  );
}

// Use this to get lazy access to getOrInit, e.g. when you don't need to create a new email form context until some UI is interacted with
export function getEmailFormRegistry(): RegistryApi {
  const ctx = useContext(EmailFormRegistryCtx);
  if (!ctx)
    throw new Error(
      'useEmailFormRegistry must be used within EmailFormContextProvider'
    );
  return ctx;
}

export function getOrInitEmailFormContext(key: string): EmailFormContextValue {
  const ctx = useContext(EmailFormRegistryCtx);
  if (!ctx)
    throw new Error(
      'useEmailFormRegistry must be used within EmailFormContextProvider'
    );
  return ctx.getOrInit(key);
}
