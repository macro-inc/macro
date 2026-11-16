import { MobileBlockHeader } from '@components/app/mobile-header/mobile-block-header';
import { SplitPermissionsBadge } from '@components/app/split-layout/components/SplitLabel';
import { useBlockAliasedName } from '@core/block';
import { isMobile } from '@core/mobile/isMobile';
import { useGetPermissions } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { useProjectHeaderTools } from '../shared/project-header-parts';

/**
 * The project block's header on touch: the title with its menu, and Info.
 * The title menu offers Share, and on phones Chat and Create too.
 */
export function MobileProjectHeader() {
  const entityKind = useBlockAliasedName();
  const permissions = useGetPermissions();
  const { id, name, ops, createTools, CreateDialog, actions } =
    useProjectHeaderTools();
  const title = useBlockDocumentName(name());

  return (
    <>
      <MobileBlockHeader
        entityKind={entityKind}
        permissions={permissions()}
        badge={<SplitPermissionsBadge />}
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
