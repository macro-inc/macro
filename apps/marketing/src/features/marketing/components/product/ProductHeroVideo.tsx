import { For, Show } from 'solid-js';
import type { TutorialVideoId } from '../../core/tutorial-videos';
import { TutorialVideoEmbed } from '../TutorialVideoEmbed';
import { type ReplacementApp, ReplacementAppIcon } from './ReplacementAppIcon';
import './product-hero-video.css';

const replacements: Partial<
  Record<TutorialVideoId, readonly ReplacementApp[]>
> = {
  mail: ['Superhuman', 'Outlook'],
  tasks: ['Jira', 'Linear', 'Asana'],
  chat: ['Slack', 'Teams'],
  docs: ['Notion', 'Word', 'Google Docs'],
  calls: ['Zoom', 'Google Meet'],
  crm: ['Salesforce', 'HubSpot'],
  agents: ['ChatGPT', 'Claude'],
  github: ['GitHub review tabs'],
  spreadsheets: ['Excel', 'Google Sheets'],
  databases: ['Airtable', 'Notion databases'],
  calendar: ['Google Calendar', 'Outlook'],
  drive: ['Dropbox', 'Google Drive'],
  canvas: ['Miro', 'FigJam'],
  macrod: ['Raycast snippets'],
  scheduling: ['Calendly', 'Cal.com'],
  routines: ['Zapier', 'Make'],
  skills: ['Custom GPTs', 'Claude Projects'],
};

/** Handwritten alternatives belong to feature heroes, not every video embed. */
export function ProductHeroVideo(props: {
  tutorial: TutorialVideoId;
  backdrop?: boolean;
}) {
  return (
    <Show
      when={replacements[props.tutorial]}
      fallback={
        <TutorialVideoEmbed
          tutorial={props.tutorial}
          backdrop={props.backdrop}
        />
      }
    >
      {(names) => (
        <div class="product-hero-video">
          <TutorialVideoEmbed
            tutorial={props.tutorial}
            backdrop={props.backdrop}
          />
          <aside class="product-replacements" aria-label="Replaces">
            <span class="product-replacements-label">Replaces</span>
            <ul>
              <For each={names()}>
                {(name) => (
                  <li>
                    <ReplacementAppIcon name={name} />
                  </li>
                )}
              </For>
            </ul>
          </aside>
        </div>
      )}
    </Show>
  );
}
