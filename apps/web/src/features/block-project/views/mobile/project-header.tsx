import { MobileBlockHeader } from '@components/app/mobile-header/mobile-block-header';
import { isMobile } from '@core/mobile/isMobile';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { useProjectHeaderTools } from '../shared/project-header-parts';

/**
 * The project block's header on touch: the title with its menu, and Info.
 * The title menu offers Share, and on phones Chat and Create too.
 */
export function MobileProjectHeader() {
  const { id, name, ops, createTools, CreateDialog, actions } =
    useProjectHeaderTools();
  const title = useBlockDocumentName(name());

  return (
    <>
      <MobileBlockHeader
        id={id}
        name={title() ?? ''}
        menuName={name()}
        iconType="project"
        itemType="project"
        menuTools={
          isMobile()
            ? [actions.chat, ...createTools, actions.share]
            : [actions.share]
        }
        ops={ops()}
      />
      <CreateDialog />
    </>
  );
}
