import LinkIcon from '@phosphor/link.svg';
import { CopyButton } from '@ui';
import { useCrmContext } from '../context/crm-context';

export function CrmCopyLinkButton(props: {
  id: string;
  type: 'company' | 'contact';
}) {
  const { copyRecordLink } = useCrmContext();
  const copyLink = () => copyRecordLink({ type: props.type, id: props.id });

  return (
    <CopyButton
      variant="ghost"
      size="icon-md"
      label={`Copy ${props.type} link`}
      tooltip={`Copy ${props.type} link`}
      onClick={copyLink}
    >
      <LinkIcon class="size-3.5!" />
    </CopyButton>
  );
}
