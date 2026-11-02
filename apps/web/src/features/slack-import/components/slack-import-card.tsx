import SlackIcon from '@icon/slack-color.svg';
import { Button } from '@ui';
import type { JSX } from 'solid-js';
import { IntegrationRow, SettingsSurface } from '../../settings/primitives';

type Props = { onOpen(trigger: HTMLButtonElement): void };

/** The Integrations row that opens the team's Slack export importer. */
export function SlackImportCard(props: Props): JSX.Element {
  return (
    <SettingsSurface>
      <IntegrationRow
        icon={<SlackIcon />}
        title="Slack export"
        description="Import your team's channels and message history from a Slack export into Channels."
      >
        <Button
          variant="secondary"
          size="sm"
          onClick={(event) => props.onOpen(event.currentTarget)}
        >
          Import from Slack
        </Button>
      </IntegrationRow>
    </SettingsSurface>
  );
}
