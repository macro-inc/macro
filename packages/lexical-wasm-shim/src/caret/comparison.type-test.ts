import { compareNumberWithUpstreamType } from '../compatibility-exceptions';
import type { PointCaret } from '../selection/runtime';
import { $comparePointCaretNext } from './ancestry';

declare const caret: PointCaret<'next'>;
export const numericOrder: -1 | 0 | 1 = compareNumberWithUpstreamType(NaN, 0);
export const caretOrder: -1 | 0 | 1 = $comparePointCaretNext(caret, caret);
