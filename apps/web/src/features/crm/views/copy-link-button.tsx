import LinkIcon from '@phosphor/link.svg';
import { Button } from '@ui';
import { useCrmContext } from '../context/crm-context';

export function CrmCopyLinkButton(props: {
  id: string;
  type: 'company' | 'contact';
}) {
  const { copyRecordLink } = useCrmContext();
  const copyLink = () => copyRecordLink({ type: props.type, id: props.id });

  return (
    <Button
      variant="outline"
      size="sm"
      depth={2}
      class="shrink-0 bg-surface"
      label={`Copy ${props.type} link`}
      tooltip={`Copy ${props.type} link`}
      onClick={() => void copyLink()}
    >
      <LinkIcon class="size-3.5" />
      Copy link
    </Button>
  );
}
