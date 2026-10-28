import { buttonClasses } from '@ui';
import { SettingsCard, SettingsPage, SettingsRow } from '../primitives';

export function DesktopAppDownload() {
  return (
    <SettingsPage
      title="Desktop App (Alpha)"
      description="Get Macro Alpha for your computer."
    >
      <SettingsCard>
        <SettingsRow
          label="Download Macro Alpha"
          description="Get the latest release for macOS or Linux."
          stackOnNarrow
        >
          <a
            href="https://github.com/macro-inc/macro/releases/latest"
            target="_blank"
            rel="noopener noreferrer"
            class={buttonClasses({ variant: 'secondary', size: 'md' })}
          >
            Download desktop app
          </a>
        </SettingsRow>
      </SettingsCard>
    </SettingsPage>
  );
}
