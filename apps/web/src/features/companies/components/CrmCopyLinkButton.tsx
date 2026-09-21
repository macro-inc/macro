import { toast } from '@core/component/Toast/Toast';
import { buildSimpleEntityUrl } from '@core/util/url';
import LinkIcon from '@phosphor/link.svg';
import { Button } from '@ui';

export function CrmCopyLinkButton(props: {
  id: string;
  type: 'company' | 'contact';
}) {
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(
        buildSimpleEntityUrl({ id: props.id, type: props.type })
      );
      toast.success('Link copied to clipboard');
    } catch {
      toast.failure('Could not copy link. Please try again.');
    }
  };

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
