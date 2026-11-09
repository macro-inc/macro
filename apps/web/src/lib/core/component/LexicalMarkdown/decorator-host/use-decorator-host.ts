import { useContext } from 'solid-js';
import { DecoratorHostContext } from '../context/DecoratorHostContext';
import { LexicalWrapperContext } from '../context/LexicalWrapperContext';
import { createLexicalDecoratorHost } from './lexical';

export function useDecoratorHost() {
  const host = useContext(DecoratorHostContext);
  const wrapper = useContext(LexicalWrapperContext);
  return host ?? createLexicalDecoratorHost(wrapper);
}
