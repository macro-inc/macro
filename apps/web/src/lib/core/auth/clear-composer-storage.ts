/** Remove saved composer text and attachment references on explicit logout. */
export function clearComposerStorage(): void {
  for (let index = localStorage.length - 1; index >= 0; index--) {
    const key = localStorage.key(index);
    if (
      key?.startsWith('input-value-') ||
      key?.startsWith('attachment-tracker-')
    ) {
      localStorage.removeItem(key);
    }
  }
}
