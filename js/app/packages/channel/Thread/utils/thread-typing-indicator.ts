import { idToDisplayName } from '@core/user';

export function getThreadTypingIndicatorText(userIds: string[]): string {
  switch (userIds.length) {
    case 0:
      return '';
    case 1:
      return `${idToDisplayName(userIds[0])} is typing`;
    case 2:
      return `${idToDisplayName(userIds[0])} and ${idToDisplayName(userIds[1])} are typing`;
    default:
      return 'Multiple people are typing';
  }
}
