import { MobileBlockHeader } from '@components/app/mobile-header/mobile-block-header';
import { isMobile } from '@core/mobile/isMobile';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { useProjectHeaderTools } from '../shared/project-header-parts';

/**
 * The project block's header on touch: the title with its menu, and Info.
 * On phones the title menu also offers Chat and Create.
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
        menuTools={isMobile() ? [actions.chat, ...createTools] : []}
        ops={ops()}
      />
      <CreateDialog />
    </>
  );
}
