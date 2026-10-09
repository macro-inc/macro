import At from '@phosphor/at.svg';
import Buildings from '@phosphor/buildings.svg';
import Chat from '@phosphor/chat-teardrop.svg';
import Database from '@phosphor/database.svg';
import Envelope from '@phosphor/envelope.svg';
import FileText from '@phosphor/file-text.svg';
import Folder from '@phosphor/folder-simple.svg';
import Plugs from '@phosphor/plugs-connected.svg';
import type { JSX } from 'solid-js';
import { SwitchBrandIcon } from '../graphics/SwitchGraphic';
import { MigrationPathSelector } from './MigrationPathSelector';

function PathSection(props: {
  title: string;
  icon: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <div class="migration-path-section">
      <h4>
        <span class="migration-row-icon" aria-hidden="true">
          {props.icon}
        </span>
        {props.title}
      </h4>
      <p>{props.children}</p>
    </div>
  );
}

function PathContent(props: {
  icon: JSX.Element;
  title: string;
  description: string;
  children: JSX.Element;
}) {
  return (
    <div class="migration-path">
      <header>
        <span class="migration-path-icon" aria-hidden="true">
          {props.icon}
        </span>
        <div>
          <h3>{props.title}</h3>
          <p>{props.description}</p>
        </div>
      </header>
      <div class="migration-path-instructions">{props.children}</div>
    </div>
  );
}

export function MigrationPaths(props: { helpHref: string }) {
  const help = () => (
    <a href={props.helpHref} target="_blank" rel="noreferrer">
      Talk to our team →
    </a>
  );
  const tabs = [
    {
      id: 'email',
      label: 'Email',
      icon: () => <Envelope aria-hidden="true" width="18" height="18" />,
      content: (
        <PathContent
          icon={<Envelope />}
          title="Bring your inbox into Macro"
          description="Connect Gmail or Google Workspace and use Macro for your daily email. Your mail stays in Gmail and syncs with Macro."
        >
          <PathSection icon={<Plugs />} title="Connect your account">
            Connect Gmail during signup or add it in Settings. Add your other
            Gmail accounts to bring them into the same inbox.
          </PathSection>
          <PathSection icon={<At />} title="Your email address">
            Send and receive from your existing address, with your mail and
            labels available in Macro. This works whether you currently read
            Gmail in a browser, Superhuman, or another email client.
          </PathSection>
          <PathSection icon={<Chat />} title="Other email providers">
            Talk to our team about your email setup and the best way to use
            Macro with it. {help()}
          </PathSection>
        </PathContent>
      ),
    },
    {
      id: 'files',
      label: 'Files & data',
      icon: () => <Folder aria-hidden="true" width="18" height="18" />,
      content: (
        <PathContent
          icon={<Folder />}
          title="Bring your files and records"
          description="Upload files and import CSV data from the tools your company uses. Organize the work in Macro and share it with your team."
        >
          <PathSection icon={<FileText />} title="Documents and files">
            Upload your documents, PDFs, images, and other files into Macro.
            Organize them in folders so your team can find and share them.
          </PathSection>
          <PathSection icon={<Database />} title="Tables and exported data">
            Import a CSV into a Macro database. Review the rows and columns in
            the import preview, then bring the records into your workspace.
          </PathSection>
          <PathSection icon={<Buildings />} title="Company records">
            In CRM, import a CSV with name and domain columns to create company
            records. Review the companies before importing them.
          </PathSection>
          <PathSection icon={<Plugs />} title="Moving data from another system">
            Tell our team what you use and what you want to bring over. We’ll
            help you choose the right import path. {help()}
          </PathSection>
        </PathContent>
      ),
    },
    {
      id: 'docs-tasks',
      label: 'Docs & tasks',
      icon: () => <FileText aria-hidden="true" width="18" height="18" />,
      content: (
        <PathContent
          icon={<FileText />}
          title="Bring your docs and tasks into Macro"
          description="Import documents and tasks into Macro so your team can write, assign work, and follow progress in the same workspace."
        >
          <PathSection
            icon={<SwitchBrandIcon brand="notion" size={19} />}
            title="Notion pages"
          >
            Connect Notion in Settings, then ask an agent to find the pages you
            want to bring over. Choose the suggested pages or provide a page
            link. Page text, headings, lists, checklists, and tables become
            editable Macro docs. For database records, export a CSV and use
            Macro’s database import.
          </PathSection>
          <PathSection
            icon={<SwitchBrandIcon brand="linear" size={19} />}
            title="Linear tasks"
          >
            Connect Linear and ask an agent to find the issues you need.
            Selected issues become Macro tasks with their descriptions, source
            links, and supported task properties. You can also upload a Linear
            CSV export, review the preview, and match assignees before
            importing.
          </PathSection>
          <PathSection icon={<Plugs />} title="Jira, ClickUp, and other tools">
            Connect your app in Settings and ask an agent what it can bring
            over. Files and CSV exports are another route for tools without a
            dedicated importer.{' '}
            <a href="https://docs.macro.com/switch-to-macro">
              See import details
            </a>
            .
          </PathSection>
        </PathContent>
      ),
    },
    {
      id: 'conversations',
      label: 'Conversations',
      icon: () => <Chat aria-hidden="true" width="18" height="18" />,
      content: (
        <PathContent
          icon={<Chat />}
          title="Bring your team’s conversations"
          description="Move discussions into Macro channels, where conversations connect directly to your docs, tasks, and email."
        >
          <PathSection
            icon={<SwitchBrandIcon brand="slack" size={19} />}
            title="Bring over Slack channels"
          >
            Connect Slack, find your channels, and select the ones to bring into
            Macro. The channel import creates the corresponding channels for
            your team.
          </PathSection>
          <PathSection icon={<Folder />} title="Import conversation history">
            Upload a Slack export ZIP and select the conversations you want to
            bring over. This copies the selected history into Macro. New Slack
            messages remain in Slack.
          </PathSection>
          <PathSection icon={<Plugs />} title="Keep Slack connected">
            Agents can search connected Slack content while your team works in
            Macro. You can keep using Slack for conversations with customers and
            partners.
          </PathSection>
          <PathSection icon={<Chat />} title="Other chat tools">
            Talk to our team about your conversation history and exports. We’ll
            help plan the move. {help()}
          </PathSection>
        </PathContent>
      ),
    },
    {
      id: 'other-tools',
      label: 'Other tools',
      icon: () => <Plugs aria-hidden="true" width="18" height="18" />,
      content: (
        <PathContent
          icon={<Plugs />}
          title="Find a path for your tools"
          description="Connect your app and ask an agent to find the work you want to bring over, or start with a file or CSV export."
        >
          <PathSection icon={<Plugs />} title="Find and connect your app">
            Search the connector catalog in Settings and sign in to your tool.
            You can also add a custom MCP connection for a tool that provides
            one.
          </PathSection>
          <PathSection icon={<Plugs />} title="Use connected information">
            Tell an agent which project, pages, or issues you need. It can use
            the tools available through your connection to find relevant work.
            Choose what to import and manage the resulting docs or tasks in
            Macro.
          </PathSection>
          <PathSection icon={<Plugs />} title="Bring an export">
            Files and CSV exports provide another route into Macro. Tell our
            team what you want to move, and we’ll help you choose between an
            import, a connection, or a file upload. {help()}
          </PathSection>
        </PathContent>
      ),
    },
  ];

  return (
    <>
      <style>{`
        .migration-path { box-sizing: border-box; padding: 44px 52px; font-family: Inter, body, sans-serif; }
        .migration-path > header, .migration-path-instructions { max-width: 760px; margin-inline: auto; }
        .migration-path > header { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 16px; align-items: start; }
        .migration-path > header > div { display: contents; }
        .migration-path > header h3 { margin: 0; }
        .migration-path > header p { grid-column: 1 / -1; }
        .migration-path-icon { display: flex; align-items: center; justify-content: center; height: 36.8px; color: var(--c2); }
        .migration-path-icon > svg { width: 30px; height: 30px; }
        .migration-row-icon { display: inline-flex; flex: none; color: var(--c4); padding-top: 2px; }
        .migration-row-icon > svg { width: 19px; height: 19px; }
        .migration-path-section { display: grid; grid-template-columns: 205px minmax(0, 1fr); gap: 28px; border-top: 1px solid color-mix(in srgb, var(--c4) 14%, transparent); padding-top: 24px; }
        .migration-path h3 { color: var(--c1); font-family: display; font-size: 32px; font-weight: 315; line-height: 1.15; letter-spacing: -0.015em; margin: 0 0 20px; }
        .migration-path p { color: var(--c4); font-size: 15px; line-height: 1.7; margin: 0; text-wrap: pretty; }
        .migration-path-instructions { display: grid; gap: 24px; margin-top: 32px; }
        .migration-path h4 { display: flex; gap: 12px; align-items: flex-start; color: var(--c1); font-size: 16px; font-weight: 600; line-height: 1.5; margin: 0 0 8px; }
        .migration-path a { color: var(--c1); text-underline-offset: 4px; }
        @media (max-width: 999px) {
          .migration-path-section { grid-template-columns: minmax(0, 1fr); gap: 6px; }
        }
        @media (max-width: 699px) {
          .migration-path > header { grid-template-columns: 26px minmax(0, 1fr); gap: 16px 12px; }
          .migration-path-icon { height: 29.9px; }
          .migration-path-icon > svg { width: 24px; height: 24px; }
          .migration-path { padding: 28px 20px; }
          .migration-path h3 { font-size: 26px; }
          .migration-path p, .migration-path h4 { font-size: 15px; }
        }
      `}</style>
      <MigrationPathSelector tabs={tabs} />
    </>
  );
}
