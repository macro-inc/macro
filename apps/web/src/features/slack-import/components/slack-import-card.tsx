import SlackIcon from '@icon/mcp-slack.svg';
import { Button } from '@ui';
import type { JSX } from 'solid-js';
import { IntegrationRow, SettingsCard } from '../../settings/primitives';

type Props = { onOpen(trigger: HTMLButtonElement): void };

export function SlackImportCard(props: Props): JSX.Element {
  return (
    <SettingsCard>
      <IntegrationRow
        icon={<SlackIcon />}
        title="Import from Slack"
        description="Import conversations from a Slack export, with optional message history."
      >
        <Button onClick={(event) => props.onOpen(event.currentTarget)}>
          Import from Slack
        </Button>
      </IntegrationRow>
    </SettingsCard>
  );
}
