export function downloadFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  let anchor: HTMLAnchorElement | null = null;
  try {
    anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.ariaLabel = 'hidden-download-link';
    anchor.style.display = 'none';

    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    // Clean up even if an error occurs
    if (anchor != null) {
      document.body.removeChild(anchor);
    }
    URL.revokeObjectURL(url);
  }
}
