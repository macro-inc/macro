import { useContext } from 'solid-js';
import {
  type DecoratorHost,
  DecoratorHostContext,
} from '../context/DecoratorHostContext';
import { LexicalWrapperContext } from '../context/LexicalWrapperContext';
import { createLexicalDecoratorHost } from './lexical';

export type DiffInsertHost = Pick<DecoratorHost, 'diffInsert'>;

export function useDiffInsertHost(): DiffInsertHost {
  const host = useContext(DecoratorHostContext);
  const wrapper = useContext(LexicalWrapperContext);
  if (!host) return createLexicalDecoratorHost(wrapper);
  if (host.diffInsert === undefined)
    throw new Error('DiffInsert requires its diff-owner capability');
  return { diffInsert: host.diffInsert };
}
