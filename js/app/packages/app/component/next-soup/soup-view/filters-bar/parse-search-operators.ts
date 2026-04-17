export type OperatorType = 'index' | 'in' | 'from';

export type ActiveOperator = {
  type: OperatorType;
  partial: string;
  startIndex: number;
  endIndex: number;
};

export function detectActiveOperator(
  text: string,
  cursorPosition: number
): ActiveOperator | null {
  const before = text.slice(0, cursorPosition);
  const match = before.match(/(^|\s)(index|in|from):(\S*)$/);
  if (!match) return null;

  const type = match[2] as OperatorType;
  const partial = match[3];
  const startIndex = match.index! + match[1].length;
  const endIndex = cursorPosition;

  return { type, partial, startIndex, endIndex };
}

export function stripOperatorAtRange(
  text: string,
  startIndex: number,
  endIndex: number
): string {
  const before = text.slice(0, startIndex);
  const after = text.slice(endIndex);
  return (before + after).replace(/\s{2,}/g, ' ').trim();
}
