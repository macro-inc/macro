import { createContext, type ParentProps, useContext } from 'solid-js';
import {
  createEmailFormState,
  type EmailFormStateOptions,
} from '../primitives/email-form-state';
import type {
  EmailFormContextValue,
  FormAccessKey,
} from '../primitives/email-form-types';
import type { EmailFormContextInputs } from './email-form-inputs';

// `seed` identifies the draft version the form seeds from (see ThreadReplyInput's
// seed key), so a composer remounting on a newer draft version gets a
// freshly derived form instead of the cached one.
const stringifyKey = (key: FormAccessKey) => {
  return `${key.type}_${key.messageId}_${key.seed ?? ''}`;
};

type RegistryApi = {
  getOrInit: (key?: FormAccessKey) => EmailFormContextValue;
};

const EmailFormRegistryCtx = createContext<RegistryApi>();

export function EmailFormContextProvider(
  props: ParentProps<{
    context: EmailFormContextInputs;
    formOptions: EmailFormStateOptions;
  }>
) {
  const map = new Map<string, EmailFormContextValue>();

  const getOrInit: RegistryApi['getOrInit'] = (key) => {
    if (!key) {
      return createEmailFormState(props.context);
    }
    const stringifiedKey = stringifyKey(key);
    let existing = map.get(stringifiedKey);
    if (!existing) {
      existing = createEmailFormState(props.context, key, props.formOptions);
      map.set(stringifiedKey, existing);
    }
    return existing;
  };

  return (
    <EmailFormRegistryCtx.Provider value={{ getOrInit }}>
      {props.children}
    </EmailFormRegistryCtx.Provider>
  );
}

export function getOrInitEmailFormContext(
  key?: FormAccessKey
): EmailFormContextValue {
  const ctx = useContext(EmailFormRegistryCtx);
  if (!ctx)
    throw new Error(
      'useEmailFormRegistry must be used within EmailFormContextProvider'
    );
  return ctx.getOrInit(key);
}
