import { useContext } from 'solid-js';
import {
  type DecoratorHost,
  DecoratorHostContext,
} from '../context/DecoratorHostContext';
import { LexicalWrapperContext } from '../context/LexicalWrapperContext';
import { createLexicalDecoratorHost } from './lexical';

export type EquationHost = Pick<DecoratorHost, 'isSelected' | 'equation'>;

export function useEquationHost(): EquationHost {
  const host = useContext(DecoratorHostContext);
  const wrapper = useContext(LexicalWrapperContext);
  if (!host) return createLexicalDecoratorHost(wrapper);
  if (typeof host.isSelected !== 'function' || host.equation === undefined)
    throw new Error('Equation requires selection and equation capabilities');
  return { isSelected: host.isSelected, equation: host.equation };
}
