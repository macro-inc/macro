import { useBlockAliasedName, useBlockId } from '@core/block';
import { useUrlParams } from '@core/component/ParamsProvider';
import { DocumentConversation } from '@core/messages/DocumentConversation';
import { useCanComment, useIsDocumentOwner } from '@core/signal/permissions';
import { buildSimpleEntityUrl } from '@core/util/url';
import { URL_PARAMS } from '../constants';

export function DocumentDiscussion(props: { label?: string } = {}) {
  const id = useBlockId();
  const blockName = useBlockAliasedName();
  const params = useUrlParams(URL_PARAMS);
  const canWrite = useCanComment();
  const canManage = useIsDocumentOwner();
  return (
    <DocumentConversation
      parent={{ type: 'document', id }}
      canWrite={canWrite()}
      canManage={canManage()}
      targetId={params.commentId()}
      label={props.label}
      buildLink={(message) =>
        buildSimpleEntityUrl(
          { type: blockName, id },
          { [URL_PARAMS.commentId]: message.id }
        )
      }
    />
  );
}
