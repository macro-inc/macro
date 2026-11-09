/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the repository root.
 * Ported from pinned lexical v0.45.0.
 */
import { LTR_REGEX, RTL_REGEX } from '../constants';

export { toggleTextFormat as toggleTextFormatType } from '../nodes/format';

export function mergeRegister(...func: Array<() => void>): () => void {
  return () => {
    for (let i = func.length - 1; i >= 0; i--) {
      func[i]();
    }
    // Clean up the references and make future calls a no-op
    func.length = 0;
  };
}

export function getTextDirection(text: string): 'ltr' | 'rtl' | null {
  if (RTL_REGEX.test(text)) return 'rtl';
  if (LTR_REGEX.test(text)) return 'ltr';
  return null;
}
