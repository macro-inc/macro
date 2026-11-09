import type { buildImportMap as Original } from 'lexical';
import type { buildImportMap as Actual } from '../nodes/build-import-map';
import type {
  DOMConversionMap,
  DOMConversionPropByTagName,
} from '../nodes/dom-types';

type Assert<T extends true> = T;
type SharedTagMap = {
  input: (node: HTMLInputElement) => {
    conversion: (node: HTMLInputElement) => null;
  };
};
export type OriginalAcceptsTagMap = Assert<
  SharedTagMap extends Parameters<typeof Original<'input'>>[0] ? true : false
>;
export type ActualAcceptsSameTagMap = Assert<
  SharedTagMap extends Parameters<typeof Actual<'input'>>[0] ? true : false
>;
type InvalidMap = { input: (node: string) => null };
export type OriginalRejectsWrongNode = Assert<
  InvalidMap extends Parameters<typeof Original<'input'>>[0] ? false : true
>;
export type ActualRejectsWrongNode = Assert<
  InvalidMap extends Parameters<typeof Actual<'input'>>[0] ? false : true
>;
type InputMap = { input: DOMConversionPropByTagName<'input'> };
export type AcceptsTagMap = Assert<
  InputMap extends Parameters<typeof Actual<'input'>>[0] ? true : false
>;
export type ReturnsMap = Assert<
  ReturnType<typeof Actual> extends DOMConversionMap ? true : false
>;
