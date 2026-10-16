import SlackIcon from '@icon/mcp-slack.svg';
import { Button } from '@ui';
import type { JSX } from 'solid-js';
import { IntegrationRow } from '../../settings/primitives';

type Props = { onOpen(trigger: HTMLButtonElement): void };

/** The Connections row that opens the importer; the host supplies the card. */
export function SlackImportCard(props: Props): JSX.Element {
  return (
    <IntegrationRow
      icon={<SlackIcon />}
      title="Slack"
      description="Import channels and message history from a Slack export."
    >
      <Button
        variant="outline"
        size="sm"
        depth={3}
        onClick={(event) => props.onOpen(event.currentTarget)}
      >
        Import from Slack
      </Button>
    </IntegrationRow>
  );
}
