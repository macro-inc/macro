import { t } from '@app/lib/i18n';
import type { BlockTool } from '@components/app/block-tool';
import { MobileBlockHeader } from '@components/app/mobile-header/mobile-block-header';
import { SplitPermissionsBadge } from '@components/app/split-layout/components/SplitLabel';
import { useBlockAliasedName, useBlockId } from '@core/block';
import { isMobile } from '@core/mobile/isMobile';
import { useGetPermissions } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import CodeIcon from '@icon/system/regular/code.svg';
import { CodeFileTypeChip } from '../../component/CodeFileTypeChip';
import {
  type CodeHeaderProps,
  useCodeHeaderTools,
} from '../shared/code-header-parts';

/**
 * The code block's header on touch: the title with its menu, and Info. On
 * tablets an HTML file's title menu switches between its code and the
 * rendered page.
 */
export function MobileCodeHeader(props: CodeHeaderProps) {
  const permissions = useGetPermissions();
  const blockId = useBlockId();
  const blockAlias = useBlockAliasedName();
  const name = useBlockDocumentName();
  const { ops, actions } = useCodeHeaderTools();

  const htmlView: BlockTool = {
    label: () =>
      props.mode === 'code'
        ? t('entityActions.showHtmlRendered')
        : t('entityActions.showHtmlCode'),
    icon: CodeIcon,
    action: () => props.onModeChange(props.mode === 'code' ? 'render' : 'code'),
    condition: () => props.isHtmlFile && !isMobile(),
  };

  return (
    <MobileBlockHeader
      entityKind={blockAlias}
      permissions={permissions()}
      badge={<SplitPermissionsBadge />}
      id={blockId}
      name={name() ?? ''}
      iconType={blockAlias}
      badges={<CodeFileTypeChip />}
      menuTools={[htmlView, actions.askMacro, actions.share]}
      ops={ops}
    />
  );
}
