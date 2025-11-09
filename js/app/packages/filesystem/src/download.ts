export function downloadFile(file: File | Blob, name?: string): void {
  const url = URL.createObjectURL(file);
  let anchor: HTMLAnchorElement | null = null;
  try {
    anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name || (file as any).name || 'download';
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
