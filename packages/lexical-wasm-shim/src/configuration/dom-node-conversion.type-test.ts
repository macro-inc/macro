import type { invokeDOMConversionWithNode } from '../compatibility-exceptions';
import type { DOMConversion, DOMConversionOutput } from '../nodes/dom-types';
import { getDOMNodeConversionFunction } from './html-conversions';

type FactoryResult = ReturnType<
  typeof invokeDOMConversionWithNode<DOMConversion | null>
>;
type ConverterResult = ReturnType<
  typeof invokeDOMConversionWithNode<DOMConversionOutput | null>
>;
declare const factoryResult: FactoryResult;
declare const converterResult: ConverterResult;
export const factory: DOMConversion | null = factoryResult;
export const converted: DOMConversionOutput | null = converterResult;
declare const text: Text;
export const selection = getDOMNodeConversionFunction(text, new Map());
export const output: DOMConversionOutput | null =
  selection === null ? null : selection(text);
