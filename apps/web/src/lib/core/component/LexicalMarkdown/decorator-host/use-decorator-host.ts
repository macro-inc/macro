import { useContext } from 'solid-js';
import {
  type DecoratorHost,
  type DecoratorHostCapabilities,
  DecoratorHostContext,
} from '../context/DecoratorHostContext';
import { LexicalWrapperContext } from '../context/LexicalWrapperContext';
import { createLexicalDecoratorHost } from './lexical';

function completeHost(host: DecoratorHostCapabilities): host is DecoratorHost {
  return (
    typeof host.isSelected === 'function' &&
    typeof host.isEditable === 'function' &&
    typeof host.isInteractable === 'function' &&
    typeof host.updateUserDisplayName === 'function' &&
    host.horizontalRule !== undefined &&
    host.equation !== undefined &&
    host.image !== undefined
  );
}

export function useDecoratorHost() {
  const host = useContext(DecoratorHostContext);
  const wrapper = useContext(LexicalWrapperContext);
  if (!host) return createLexicalDecoratorHost(wrapper);
  if (!completeHost(host))
    throw new Error('Decorator requested capabilities missing from its host');
  return host;
}
