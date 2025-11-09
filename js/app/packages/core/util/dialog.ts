/** only used for alert+confirm within PDF/DocumentManager and InternalPDFViewer */
// TODO: move to PDF block package when Luis is finished separating
export function showMessageBoxSync(options: {
  type: 'confirm' | string;
  message: string;
  [k: string]: any;
}): number {
  // we should probably replace it entirely with our modals, but for now:
  if (options.type === 'confirm') {
    const result = window.confirm(options.message);
    // Expects yes = 0, 1 = cancel
    return result ? 0 : 1;
  } else {
    alert(options.message);
    return 0;
  }
}
