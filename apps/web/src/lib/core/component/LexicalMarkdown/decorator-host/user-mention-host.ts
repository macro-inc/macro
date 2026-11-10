import { useContext } from 'solid-js';
import {
  type DecoratorHost,
  DecoratorHostContext,
} from '../context/DecoratorHostContext';
import { LexicalWrapperContext } from '../context/LexicalWrapperContext';
import { createLexicalDecoratorHost } from './lexical';

/** Only the actual shared user-mention component's editor operations. */
export type UserMentionHost = Pick<
  DecoratorHost,
  'isSelected' | 'updateUserDisplayName'
>;

export function useUserMentionHost(): UserMentionHost {
  const host = useContext(DecoratorHostContext);
  const wrapper = useContext(LexicalWrapperContext);
  if (!host) return createLexicalDecoratorHost(wrapper);
  if (
    typeof host.isSelected !== 'function' ||
    typeof host.updateUserDisplayName !== 'function'
  )
    throw new Error(
      'User mention requires selection and display-name capabilities'
    );
  return {
    isSelected: host.isSelected,
    updateUserDisplayName: host.updateUserDisplayName,
  };
}
