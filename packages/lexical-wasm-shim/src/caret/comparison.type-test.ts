import type { compareNumberWithUpstreamType } from '../compatibility-exceptions';
import type { $comparePointCaretNext } from './ancestry';

type Assert<Condition extends true> = Condition;
export type NumericResult = Assert<
  ReturnType<typeof compareNumberWithUpstreamType> extends -1 | 0 | 1
    ? true
    : false
>;
export type CompleteNumericResult = Assert<
  -1 | 0 | 1 extends ReturnType<typeof compareNumberWithUpstreamType>
    ? true
    : false
>;
export type NumericInputs = Assert<
  Parameters<typeof compareNumberWithUpstreamType> extends [number, number]
    ? true
    : false
>;
export type CaretResult = Assert<
  ReturnType<typeof $comparePointCaretNext> extends -1 | 0 | 1 ? true : false
>;
