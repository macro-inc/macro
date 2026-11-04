import { toast } from '@core/component/Toast/Toast';

/** The name worth copying for a person, or undefined when it only repeats
 *  their address or stands in for the viewer. */
export function copyableName(
  displayName: string,
  email: string | undefined
): string | undefined {
  const name = displayName.trim();
  if (!name) return undefined;
  if (name.toLowerCase() === 'me') return undefined;
  if (email && name.toLowerCase() === email.toLowerCase()) return undefined;
  const localPart = email?.split('@')[0];
  if (localPart && name.toLowerCase() === localPart.toLowerCase()) {
    return undefined;
  }
  return name;
}

/** Copies a person's email or name and confirms with a toast; rejects when
 *  the clipboard refuses, after reporting it. */
export async function copyUserDetail(value: string, toastMessage: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch (error) {
    toast.failure('Failed to copy to clipboard');
    throw error;
  }
  toast.success(toastMessage);
}
