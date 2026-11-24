import type { TutorialVideoId } from './tutorial-videos';

export type WorkspaceFeature = {
  tutorial?: TutorialVideoId;
  product:
    | 'Spreadsheets'
    | 'Databases'
    | 'Canvas'
    | 'Snippets'
    | 'Calendar'
    | 'Booking links'
    | 'Drive'
    | 'Routines'
    | 'Skills';
  title: string;
  description: string;
  heading: string;
  detail: string;
  sceneTitle: string;
  rows: readonly string[];
  message: string;
  /** `id` is the section's anchor and its key in `featureScreens`, where a page renders sections by id. */
  sections?: readonly { id?: string; title: string; description: string }[];
  faq: readonly { q: string; a: string }[];
};

/** Product facts from apps/docs; wording follows Jacob’s product notes. */
export const workspaceFeatures: Record<string, WorkspaceFeature> = {
  spreadsheets: {
    tutorial: 'spreadsheets',
    product: 'Spreadsheets',
    title: 'Sheets @linked to your work.',
    description:
      'Fast collaborative spreadsheets with live agent editing, workspace @mentions, and clean Excel, Sheets, and CSV import/export.',
    heading: '@mention anything in a cell.',
    detail:
      'It’s a normal spreadsheet: formulas, number formats, fill down, everything you’d expect from Excel or Google Sheets. The difference is it’s linked to everything else. Type @ in a cell to mention a person, a document from Macro Docs, an email from Macro Mail, or a task from Macro Tasks.',
    sceneTitle: 'Launch budget',
    rows: [],
    message: '',
    sections: [
      {
        title: 'Macro Agents edit the sheet like teammates.',
        description:
          'Agents can edit the sheet too including external agents like ChatGPT or Claude. Ask one to add up spend by team or build next quarter’s forecast and watch its cursor move through the cells as it works. You can all collaborate in the same sheet.',
      },
      {
        title: 'Add formulas, charts, and comments.',
        description:
          'Reference cells across sheets, add dropdowns, and build charts that update when the data changes. Leave a comment on a range so the discussion stays with the numbers.',
      },
      {
        title: 'Bring your Excel files.',
        description:
          'Upload an Excel workbook or CSV and choose Edit in Macro to make an editable copy. Export the workbook with its formulas and formatting or download one sheet as CSV.',
      },
    ],
    faq: [
      {
        q: 'Will importing change the original file?',
        a: 'No. Edit in Macro creates a separate editable copy. You can also import a workbook into an open spreadsheet as new sheets or as a replacement.',
      },
      {
        q: 'Do Excel macros run in Macro?',
        a: 'No. Macros are removed when you import an .xlsm file.',
      },
      {
        q: 'Can I share a sheet without letting people edit?',
        a: 'Yes. Give people view, comment, or edit access. Viewers can still select and copy cells.',
      },
    ],
  },
  databases: {
    tutorial: 'databases',
    product: 'Databases',
    title: 'Dear Notion, meet big data.',
    description:
      'Typed tables, boards, and timelines built for teams and agents—linked straight to your emails, docs, tasks, and forms.',
    heading: '@mention anything in a column.',
    detail:
      'Every row is a record and every column is typed—text, numbers, formulas, dropdowns, or live @mentions of people, Macro Tasks, Macro Docs, Macro Mail, and Macro CRM companies. Link tables together and pipe Macro Forms responses straight in as rows.',
    sceneTitle: 'Launch projects',
    rows: [],
    message: 'I added the launch tasks to the table.',
    sections: [
      {
        title: 'Switch between table, board, and timeline.',
        description:
          'Keep records in the view that makes sense for the work. Saved views are shared so your team opens the same view of the database.',
      },
      {
        title: 'Ask Macro Agents to edit your records.',
        description:
          'Attach a database to Macro Agents to query data or bulk-edit rows and columns. You can also wire up Macro Routines to keep records updated automatically.',
      },
      {
        title: 'Import your Notion databases.',
        description:
          'Import from Notion inside Macro Drive—review what the agent finds, set permissions, and approve while leaving your originals untouched.',
      },
    ],
    faq: [
      {
        q: 'Can my team edit together?',
        a: 'Yes. You can see who is working in a cell and changes save automatically. If two people change the same cell, the later save wins.',
      },
      {
        q: 'Can I keep several tables in one database?',
        a: 'Yes. Add tables in the same database and use a Related table field to link their records.',
      },
      {
        q: 'Who can access a database?',
        a: 'Share it with specific people or channels or set access for your team. Choose view, comment, or edit access.',
      },
    ],
  },
  canvas: {
    tutorial: 'canvas',
    product: 'Canvas',
    title: 'An infinite connected canvas.',
    description:
      'An infinite whiteboard for diagrams and planning—with live @mentions of your real tasks, docs, emails, and calls.',
    heading: '@mention Macro Tasks, Macro Docs, and Macro Mail.',
    detail:
      'Mention a task, a document from Macro Docs, an email, or a call directly on the canvas. Task mentions show current status and priority and open the original when you need the details.',
    sceneTitle: 'Website launch',
    rows: [
      'Brief → Design → Build',
      '@Website launch plan',
      '@Prepare the launch checklist',
    ],
    message: 'I linked the brief and the launch tasks on the canvas.',
    sections: [
      {
        title: 'Put the plan on a canvas.',
        description:
          'Draw shapes, connect them with arrows, and add notes or images. Group and align the pieces as the plan takes shape.',
      },
      {
        title: 'Share the part you’re looking at.',
        description:
          'Copy a canvas link and it opens at the same pan and zoom. Give someone view, comment, or edit access just like a document.',
      },
    ],
    faq: [
      {
        q: 'How do I create a canvas?',
        a: 'Choose Canvas from the Create menu or press c then n.',
      },
      {
        q: 'Can I find a canvas later?',
        a: 'Canvases appear in unified search. You can also mention a canvas elsewhere in Macro or download it as a file.',
      },
    ],
  },
  snippets: {
    product: 'Snippets',
    title: 'Reusable snippets.',
    description:
      'Reusable markdown replies, checklists, and agent prompts shared across your team—type ; anywhere to drop one in.',
    heading: 'Save replies as reusable snippets.',
    detail:
      'Save a common reply or meeting template with its headings, checklists, and tables. Keep it personal or let your team use and edit it too.',
    sceneTitle: 'Weekly check-in',
    rows: [
      'What shipped this week?',
      'What are we working on next?',
      'Anything blocking us?',
    ],
    message: 'Type ;check-in to insert the meeting template.',
    sections: [
      {
        title: 'Insert snippets wherever you write.',
        description:
          'Type ; in Macro Docs or Macro Chat to insert a saved snippet. Snippets also work in Macro Tasks, Macro Canvas text boxes, and agent instructions. Search by name and insert the snippet with its formatting intact.',
      },
      {
        title: 'Keep your team’s templates together.',
        description:
          'Share a snippet with your team so everyone can use and edit it. Update the original once; future insertions use the new version and earlier messages stay as they were.',
      },
    ],
    faq: [
      {
        q: 'How do I create a snippet?',
        a: 'Choose Snippet from the Create menu or press c then s. Give it the name you want to search for when inserting it.',
      },
      {
        q: 'Are snippets private by default?',
        a: 'Yes. Turn on Share with team in the snippet’s side panel when you want teammates to use and edit it.',
      },
    ],
  },
  calendar: {
    tutorial: 'calendar',
    product: 'Calendar',
    title: 'A really fast calendar with agents that do the scheduling.',
    description:
      'Calendar unifies your Google and Microsoft schedules in one fast week view with instant keyboard navigation and built-in scheduling links.',
    heading: 'All your accounts in one view.',
    detail:
      'Connect multiple Google and Microsoft accounts. See your work, personal, and shared calendars together and choose which ones to show.',
    sceneTitle: 'Your calendars',
    rows: [],
    message: '',
    sections: [
      {
        id: 'calendar-team-availability',
        title: 'Find a time with your team.',
        description:
          'Ask Macro Agents in Macro Chat to find a time everyone can make. Teammates who share busy blocks show when they’re free without exposing private details.',
      },
      {
        id: 'calendar-agent-invites',
        title: 'Let Macro Agents send and edit invites.',
        description:
          'Have Macro Agents send invites, move meetings, or update guests with your approval. Events appear as live pills you can @mention anywhere in Macro.',
      },
      {
        id: 'calendar-booking-links',
        title: 'Let guests book with Macro Booking Links.',
        description:
          'Share Macro Booking Links so guests pick open times in their own time zone—no Macro account needed and answers link straight to Macro CRM and Macro Mail.',
      },
    ],
    faq: [
      {
        q: 'Can I see calendars from several accounts?',
        a: 'Yes. Connect multiple Google and Microsoft accounts in Calendar settings. Show or hide individual calendars to choose what appears in your view.',
      },
      {
        q: 'What can my teammates see?',
        a: 'Choose in Calendar settings to share busy blocks, event details, or nothing. Private events stay as busy blocks. Choose which calendars count as busy when teammates or agents check your availability.',
      },
      {
        q: 'Can I send someone my available times?',
        a: 'Copy your open times into a Macro Mail reply with your time zone included. Set working hours or use a booking link so the other person can choose a time.',
      },
      {
        q: 'Can I link an event to other work?',
        a: 'Search for an event or mention it in a conversation just like a doc or task. An agent can use that event when you ask it to reschedule or follow up.',
      },
      {
        q: 'What happens if I disconnect?',
        a: 'Macro removes its local calendar copy and permissions. Your calendar stays with Google or Microsoft and email can keep syncing.',
      },
    ],
  },
  'booking-links': {
    tutorial: 'scheduling',
    product: 'Booking links',
    title: 'Team booking links.',
    description:
      'Team scheduling and round-robin booking links built right into your workspace—no Calendly subscription or guest account needed.',
    heading: 'Book one teammate or the whole team.',
    detail:
      'Find a time when everyone is free or use round robin to book one available teammate. Set working hours, time between meetings, minimum notice, and a daily booking limit.',
    sceneTitle: 'Book a 30-minute demo',
    rows: [
      'Tuesday, October 20',
      '09:00     10:30     13:00',
      'Wednesday, October 21',
      '10:00     14:00     15:30',
    ],
    message: 'Use the team link. It will find an available host.',
    faq: [
      {
        q: 'Which calendars work?',
        a: 'Connect a Google or Outlook calendar. Busy times are excluded and bookings create calendar invitations.',
      },
      {
        q: 'When does a new link start accepting bookings?',
        a: 'New links are paused. Turn on Accept bookings when the details and availability are ready.',
      },
      {
        q: 'Can guests change a booking?',
        a: 'Yes. Their private booking receipt includes links to reschedule or cancel.',
      },
      {
        q: 'Can an agent set up a link?',
        a: 'Yes. The agent shows the details and waits for your approval before saving.',
      },
      {
        q: 'Can I limit when people book?',
        a: 'Set weekly hours, date overrides, time between meetings, minimum notice, and a daily limit. Add guest questions to collect what you need before the call.',
      },
      {
        q: 'Where do I see my bookings?',
        a: 'The Bookings tab shows upcoming, past, and cancelled meetings. Insights shows booking volume, meeting hours, no-shows, and your most-used links plus a CSV download.',
      },
    ],
  },
  drive: {
    tutorial: 'drive',
    product: 'Drive',
    title: 'Auto-organized file storage.',
    description:
      'Files from email, chat, and uploads—automatically tagged and searchable for your team and agents.',
    heading: 'Files from Macro Chat and Macro Mail land here.',
    detail:
      'Your files are usually split across Slack, Google Drive, and your computer. Everything shared in channels, DMs, and email attachments lands in one system and organizes itself automatically.',
    sceneTitle: 'Launch / Files',
    rows: [
      'Website launch plan.md',
      'Launch budget.xlsx',
      'Customer demo.mp4',
      'Brand guidelines.pdf',
    ],
    message: 'The brief, budget, and recording are in the Launch folder.',
    sections: [
      {
        title: '@mention a file to share it.',
        description:
          '@mention any file in a channel in Macro Chat and it’s shared with everyone in that channel. Join a channel, gain access. You can also mention any file to an agent, in a doc, or on a canvas.',
      },
      {
        title: 'Open pretty much any file type.',
        description:
          'Photoshop, Illustrator, Figma, PowerPoint, Word, PDFs, and video: open them right in Macro without leaving your workspace. Notes open in Macro Docs, sheets in Macro Spreadsheets, and whiteboards in Macro Canvas.',
      },
      {
        title: 'Macro Agents can read everything in Drive.',
        description:
          'Just ask a question and get an answer from your files. @mention files yourself or let the agent search your Drive for what it needs. External agents like Claude and ChatGPT can use it over MCP too with full-text search.',
      },
      {
        title: 'Folders and Macro Databases side by side.',
        description:
          'Use folders for quick sharing and Macro Databases for structured tracking—drag files in and filter by type, tag, or creator.',
      },
      {
        title: 'Auto-organized with Macro Tags.',
        description:
          'Files are tagged by customer, project, or topic as they arrive using the same tags from your emails and tasks. Filter Drive by a tag to pull up everything for a customer wherever it came from.',
      },
      {
        title: 'Files show up on Macro CRM records.',
        description:
          'Every file a customer sends lives on their company record under Files next to their emails and calls. @mention a file in Macro Tasks and it’s attached to the work it belongs to.',
      },
      {
        title: 'Macro Skills and Macro Snippets live here too.',
        description:
          'Skills and snippets are documents in Drive so you organize and share them like any other file. Keep your contract-review skill in the same folder as the contracts it reviews.',
      },
    ],
    faq: [
      {
        q: 'Where are email attachments?',
        a: 'They are extracted automatically but hidden from the default file list. Choose Filter → Files → Email attachments to see them.',
      },
      {
        q: 'Can I put a database in a folder?',
        a: 'Not currently. Create databases from the New menu in My Files, Recent, Shared with me, or the folders overview.',
      },
    ],
  },
  routines: {
    tutorial: 'routines',
    product: 'Routines',
    title: 'Agents on a schedule.',
    description:
      'Run agents on a schedule or whenever an email arrives, a task changes, or a call wraps up—no Zapier wiring required.',
    heading: 'A saved prompt run on a schedule.',
    detail:
      'Ask for a daily project update, a draft when an email arrives, or a sheet update when a task changes. Open any run’s conversation to see what the agent did.',
    sceneTitle: 'Morning project update',
    rows: [
      'Every weekday at 9:00 AM',
      'Read @Website launch',
      'Summarize blockers and overdue tasks',
      'Enabled',
    ],
    message: 'Send me the open launch blockers each morning.',
    sections: [
      {
        title: 'Run Macro Agents when your work changes.',
        description:
          'Start a routine when email arrives in Macro Mail, a task changes in Macro Tasks, or a call ends in Macro Calls. A call-ended routine gets the participants and transcript so it can work from what was discussed.',
      },
      {
        title: 'Review what each agent run did.',
        description:
          'Each run has an outcome, duration, and a conversation you can open. Run a routine now to try it or disable its triggers when you want it to stop running automatically.',
      },
      {
        title: 'Share routines with your team.',
        description:
          'Share a routine as a template and each teammate gets their own copy. It runs with their permissions and watches their inbox for email triggers.',
      },
    ],
    faq: [
      {
        q: 'Can I write the schedule in plain English?',
        a: 'Yes. Use something like every weekday at 9am or set a one-time run for tomorrow at 9am. Recurring schedules keep the time zone they were created in.',
      },
      {
        q: 'Whose access does it use?',
        a: 'A routine belongs to one person and runs with that person’s permissions. Only its owner can edit it, run it, or see its history.',
      },
      {
        q: 'Can one agent’s work trigger another routine?',
        a: 'No. Changes made by agents and bots don’t trigger routines.',
      },
    ],
  },
  skills: {
    tutorial: 'skills',
    product: 'Skills',
    title: 'Skills for your agents.',
    description:
      'Write your team’s checklists, formatting rules, and review playbooks once so every agent follows them automatically.',
    heading: 'Write the instructions once.',
    detail:
      'Save the release notes format, review checklist, or other instructions you keep giving agents. Edit the skill when the process changes; agents use the current version.',
    sceneTitle: 'Release notes',
    rows: [
      'Start with what changed for the user.',
      'Group fixes separately from new features.',
      'Link the relevant tasks and pull requests.',
      'Keep each item to one sentence.',
    ],
    message: 'Use /release-notes to draft this week’s update.',
    sections: [
      {
        title: 'Tell Macro Agents when to use it.',
        description:
          'Give the skill a clear name and describe when it should and shouldn’t be used. Agents can find a matching skill themselves or you can attach one from the / menu.',
      },
      {
        title: 'Edit a skill like a document.',
        description:
          'Skills are documents in Macro Drive. Share them like any other document so your team can maintain the same instructions.',
      },
    ],
    faq: [
      {
        q: 'How do I make a skill?',
        a: 'Choose Skill from the Create menu or New skill from the / menu in an agent conversation. Add a name and the instructions you want it to follow.',
      },
      {
        q: 'Can I edit built-in skills?',
        a: 'Built-in skills such as Catch Me Up, What I Did Yesterday, and Configure Agent cannot be edited or deleted. Create your own for team-specific instructions.',
      },
      {
        q: 'Can other agents use my skills?',
        a: 'Agents connected through Macro’s MCP server can list, search, and read skills they have access to.',
      },
    ],
  },
};
