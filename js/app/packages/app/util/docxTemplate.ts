import { platformFetch } from 'core/util/platformFetch';

async function loadDocumentTemplate(): Promise<File | undefined> {
  try {
    // Using Vite's import.meta.url to get the correct path resolution
    const response = await platformFetch(
      new URL('../asset/blank.docx', import.meta.url)
    );

    if (!response.ok) {
      console.error('Failed to load document template:', response.statusText);
    }

    return new File([await response.blob()], 'New Document.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  } catch (error) {
    console.error('Error loading document template:', error);
  }
  return;
}

export const docxTemplate = () => loadDocumentTemplate();
