import type { JSX } from 'solid-js';
import { SettingsSection } from '../../settings/primitives';

export function BotFormSection(props: {
  title: string;
  description: string;
  action?: JSX.Element;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <SettingsSection
      title={props.title}
      description={props.description}
      actions={props.action}
      class={props.class}
    >
      <div class="pt-2">{props.children}</div>
    </SettingsSection>
  );
}
