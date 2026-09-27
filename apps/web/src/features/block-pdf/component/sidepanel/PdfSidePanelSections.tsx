import {
  FileDetailsSection,
  FilePropertiesSection,
} from '@components/app/side-panel';

export function PdfSidePanelSections() {
  return (
    <>
      <FileDetailsSection order={20} />
      <FilePropertiesSection order={30} />
    </>
  );
}
