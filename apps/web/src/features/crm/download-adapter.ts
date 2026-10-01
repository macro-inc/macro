import { downloadFile } from '@filesystem/download';

export function downloadCrmCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  return downloadFile(blob, filename);
}
