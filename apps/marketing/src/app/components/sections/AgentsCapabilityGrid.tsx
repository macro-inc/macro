import { For } from 'solid-js';
import TasksAiHandoffGraphic from '../../../assets/graphics/tasks-ai-handoff.svg';
import IconGithub from '../../../assets/icons/icon-github.svg';
import IconLinear from '../../../assets/icons/logo-linear.svg';
import IconNotion from '../../../assets/icons/logo-notion.svg';
import IconSlack from '../../../assets/icons/logo-slack.svg';
import { keepLastWords } from '../../utils/utilTypography';
import { AgentGlyph } from '../featureGraphics/AgentsGraphics';
import { MacroMarkIcon } from '../graphics/MacroMarkIcon';
import './AgentsCapabilityGrid.css';

function AssignmentGraphic() {
  return (
    <div class="agents-cap-art agents-cap-assignment">
      <TasksAiHandoffGraphic />
    </div>
  );
}

function ScheduleGraphic() {
  return (
    <div class="agents-cap-art agents-cap-schedule agents-ui">
      <div class="agents-cap-schedule-control">
        <div class="agents-cap-schedule-time">
          <AgentGlyph kind="clock" />
          <span>Weekdays</span>
          <strong>8:00 AM</strong>
        </div>
        <div class="agents-cap-days">
          <For each={['M', 'T', 'W', 'T', 'F', 'S', 'S']}>
            {(day, i) => (
              <span classList={{ 'is-active': i() < 5 }}>{day}</span>
            )}
          </For>
        </div>
      </div>
      <div class="agents-cap-inbox-line" />
      <div class="agents-cap-inbox-row">
        <MacroMarkIcon />
        <div>
          <strong>Your morning brief</strong>
          <span>Two things need you today.</span>
        </div>
        <i />
      </div>
    </div>
  );
}

function PermissionsGraphic() {
  return (
    <div class="agents-cap-art agents-cap-permissions agents-ui">
      <div class="agents-cap-access-header">
        <span />
        <span>You</span>
        <MacroMarkIcon />
      </div>
      <div class="agents-cap-access-row">
        <span>
          <AgentGlyph kind="doc" /> Launch plan
        </span>
        <AgentGlyph kind="check" />
        <AgentGlyph kind="check" />
      </div>
      <div class="agents-cap-access-row is-private">
        <span>
          <AgentGlyph kind="lock" /> Private folder
        </span>
        <AgentGlyph kind="lock" />
        <AgentGlyph kind="lock" />
      </div>
      <div class="agents-cap-access-note">
        <AgentGlyph kind="lock" /> Same permissions, everywhere.
      </div>
    </div>
  );
}

function ConnectionsGraphic() {
  return (
    <div class="agents-cap-art agents-cap-connections">
      <svg viewBox="0 0 460 260" preserveAspectRatio="none" fill="none">
        <path d="M230 130H150Q130 130 130 110V65H80 M230 130H310Q330 130 330 110V65H380 M230 130H150Q130 130 130 150V195H80 M230 130H310Q330 130 330 150V195H380" />
      </svg>
      <div class="agents-cap-hub">
        <MacroMarkIcon />
        <span>MCP</span>
      </div>
      <div class="agents-cap-tool agents-cap-tool--github">
        <IconGithub />
        <span>GitHub</span>
      </div>
      <div class="agents-cap-tool agents-cap-tool--linear">
        <IconLinear />
        <span>Linear</span>
      </div>
      <div class="agents-cap-tool agents-cap-tool--notion">
        <IconNotion />
        <span>Notion</span>
      </div>
      <div class="agents-cap-tool agents-cap-tool--slack">
        <IconSlack />
        <span>Slack</span>
      </div>
    </div>
  );
}

const capabilities = [
  {
    id: 'follow-through',
    title: 'Assign it the work',
    description:
      'Give a task to @Macro. It can update docs, open a pull request, and report back with the result.',
    Graphic: AssignmentGraphic,
  },
  {
    id: 'scheduled-work',
    title: 'Set it to repeat',
    description:
      'Schedule a brief or recap. Your agent runs it and delivers the result to your inbox.',
    Graphic: ScheduleGraphic,
  },
  {
    id: 'agent-permissions',
    title: 'Your permissions apply',
    description:
      'Your agent sees what you see. Private files stay private, and existing access rules carry over.',
    Graphic: PermissionsGraphic,
  },
  {
    id: 'connected-tools',
    title: 'Connect your tools',
    description:
      'Bring other tools into Macro through MCP, or give your coding agent access to your workspace.',
    Graphic: ConnectionsGraphic,
  },
];

/** The same large-art, numbered-caption rhythm as the Tasks feature grid. */
export function AgentsCapabilityGrid() {
  return (
    <section
      class="agents-capabilities"
      id="agent-capabilities"
      aria-label="Working with Macro agents"
    >
      <For each={capabilities}>
        {(item, index) => (
          <article class="agents-capability" id={item.id}>
            <div class="agents-cap-visual" aria-hidden="true">
              <item.Graphic />
            </div>
            <div class="agents-cap-caption">
              <h2>
                <span class="agents-cap-number" aria-hidden="true">
                  {index() + 1}
                </span>
                <span>{keepLastWords(item.title)}</span>
              </h2>
              <p>{keepLastWords(item.description)}</p>
            </div>
          </article>
        )}
      </For>
    </section>
  );
}
