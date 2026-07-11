import { markdownToPlainText } from '@lexical-core/utils/parsers';

const MAX_LENGTH = 80;

export function deriveChatName(userQuery: string): string | undefined {
  const plainText = markdownToPlainText(userQuery);
  const firstLine = plainText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)[0];
  return firstLine ? firstLine.slice(0, MAX_LENGTH) : undefined;
}
