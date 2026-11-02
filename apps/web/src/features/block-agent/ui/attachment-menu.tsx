import { t } from '@app/lib/i18n';
import type { ComposerAddMenuItem } from '@channel/Input/ComposerAddMenu';
import ImageIcon from '@icon/system/regular/image.svg';
import PaperclipIcon from '@icon/system/regular/paperclip.svg';

export function agentAttachmentItems(
  openFiles: () => void,
  openImages: () => void,
  imageUnsupportedReason?: string
): ComposerAddMenuItem[] {
  return [
    {
      id: 'photos',
      label: t('common.addPhotos'),
      description: t('common.photosFromDevice'),
      icon: <ImageIcon />,
      disabledReason: imageUnsupportedReason,
      onSelect: openImages,
    },
    {
      id: 'upload',
      label: t('common.addFiles'),
      description: t('common.filesFromDevice'),
      icon: <PaperclipIcon />,
      onSelect: () => openFiles(),
    },
  ];
}
