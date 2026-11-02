import { isTouchDevice } from '@core/mobile/isTouchDevice';
import LinkIcon from '@icon/system/regular/link.svg';
import { Button, ButtonGroup, CopyButton } from '@ui';
import { useCrmContext } from '../context/crm-context';

export function CrmCopyLinkButton(props: {
  id: string;
  type: 'company' | 'contact';
  grouped?: boolean;
}) {
  const { copyRecordLink } = useCrmContext();
  const copyLink = () => copyRecordLink({ type: props.type, id: props.id });
  const size = () => {
    if (isTouchDevice()) return 'icon-lg';
    return props.grouped ? 'icon-sm' : 'icon-md';
  };

  return (
    <CopyButton
      aria-label={`Copy ${props.type} link`}
      as={props.grouped ? ButtonGroup.Button : Button}
      variant="ghost"
      size={size()}
      tooltip={`Copy ${props.type} link`}
      onClick={copyLink}
    >
      <LinkIcon class="size-4 touch:size-6" />
    </CopyButton>
  );
}
