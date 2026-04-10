import { tryMacroId, useDisplayNameParts } from '@core/user';

export function useSenderName(senderId: string | null | undefined) {
  const nameParts = useDisplayNameParts(tryMacroId(senderId ?? ''));
  return () => {
    const firstName = nameParts.firstName();
    const fullName = nameParts.fullName();
    if (firstName || fullName) {
      return firstName || fullName;
    }
    // Fallback: extract name from macro ID format (macro|email@domain.com)
    if (senderId?.startsWith('macro|')) {
      const email = senderId.slice(6);
      const namePart = email.split('@')[0];

      return namePart;
    }
    return null;
  };
}
