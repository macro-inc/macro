/**
 * Product introductions, based on the founder's README and product guides.
 * [[Macro Routines]] renders as that product's linked mention, and *asterisks*
 * italicize a word.
 */
export const productIntroductions: Partial<Record<string, readonly string[]>> =
  {
    Workspace: [
      'Most startups end up paying for Slack, Linear, Notion, HubSpot, Superhuman, and Calendly—and still spend half their week copy-pasting between them.',
      'Macro replaces those subscriptions with [[Macro Mail]], [[Macro Chat]], [[Macro Docs]], [[Macro Tasks]], [[Macro CRM]], and [[Macro Agents]] in one workspace. You cut your software bill, and your work actually stays connected.',
    ],
    'Company graph': [
      'A task almost never makes sense on its own. There’s a customer email behind it, a thread where you debated the fix, and a doc with the spec.',
      'In Macro, every @mention is a two-way link across [[Macro Mail]], [[Macro Chat]], [[Macro Docs]], and [[Macro Tasks]]. Click into a task and jump straight back to the email or PR that spawned it—no chasing teammates for background.',
    ],
    'AI tagging': [
      'Every app makes you rebuild the same labels: Gmail folders, Linear labels, Drive folders. Nobody keeps them in sync.',
      'Macro uses one set of shared tags across [[Macro Mail]], [[Macro Tasks]], [[Macro Docs]], and [[Macro Drive]]. Let [[Macro Agents]] and [[Macro Routines]] tag incoming work by customer, topic, or urgency so one click pulls up everything that belongs together.',
    ],
    'Automatic permissions': [
      'You’ve probably run into this: you share a link to, say, a Google Doc in Slack, only to receive a ping back: “Hey, I can’t open it.” The problem is that permissions are separate from channels. But what if permissions were granted when you shared anything, just like attaching a file to an email?',
      'In Macro, access follows [[Macro Chat]] membership. Share a doc, email, or task in a channel and everyone in it can open it. New teammates get the history on day one; people who leave lose access automatically.',
    ],
    'Workspace events': [
      'We want agents to be able to help when something happens at our company... but how do you know “when something happens”?',
      'If your company is spread across a bunch of software tools, there is no event system. Your agents have to constantly poll every business system to see what’s been updated, and many tools don’t even expose MCPs for events!',
      'In Macro, not only are there events for everything — customer email arriving in [[Macro Mail]], an @mention in [[Macro Chat]], or status changes in [[Macro Tasks]] — there’s a *unified* event bus for everything, so your agents only have to subscribe to one feed, and [[Macro Routines]] can kick off when things happen.',
    ],
    'Unified search': [
      'You remember what a customer asked for, not whether they said it in an email, a Slack thread, or on last Tuesday’s call.',
      'Macro indexes [[Macro Mail]], [[Macro Chat]], [[Macro Docs]], [[Macro Tasks]], [[Macro Drive]], and [[Macro Calls]] in one timestamped search index. Humans and [[Macro Agents]] query the exact same workspace and get linked sources back in milliseconds.',
    ],
    Email: [
      'There have been a million email clients, each doing something well, but none that had everything we wanted: superhuman speed, all our accounts in one inbox, auto-organized, and [[Macro Agents]] with frontier intelligence.',
      'Macro Mail does all of that, and makes email collaborative inside [[Macro Chat]], deeply linked to [[Macro Tasks]] and automatically updates your [[Macro CRM]] from emails.',
    ],
    Tasks: [
      'Traditional task managers go stale fast because they aren’t linked to the actual work—like [[Macro GitHub]] or customer conversations—and updating them by hand is too much friction.',
      '[[Macro Tasks]] are created where you already work: from [[Macro Chat]], from [[Macro Mail]], or automatically via [[Macro Agents]]. Assign a task to a teammate or an agent that ships the code or drafts the deliverable for you.',
    ],
    Chat: [
      'Moving from Slack to a separate chatbot means re-explaining the whole thread, then pasting the answer back for everyone else. We built [[Macro Chat]] so humans and [[Macro Agents]] work in the same conversation from the start.',
      'Share threads from [[Macro Mail]], link [[Macro Docs]], and spin up [[Macro Tasks]] right inside a channel. Inline threads and Signal/Noise triage keep channels focused so adding agents reduces noise instead of creating more of it.',
    ],
    Docs: [
      'Obsidian nailed plain markdown that agents can read and edit. Notion nailed mentions and team collaboration. We didn’t want to pick one—or get locked into a proprietary format and one vendor’s AI.',
      '[[Macro Docs]] gives people and [[Macro Agents]] the same CRDT-powered markdown editor, routed through a nearby server so live edits feel instant. Link [[Macro Tasks]], [[Macro Mail]], and [[Macro Calls]] inline, edit offline, and export clean markdown anytime.',
    ],
    Calls: [
      `A lot of the important context in a company is spoken, and at least until we have robots in the room with us, this context doesn't fully make it to our agents. Macro Calls fix this by injecting everything your team says into team-level memory. Your coding agents know about what was said at standup. Your marketing agents know about the idea kicked around on a call. All of this "just works" without sharing calls and worrying about permissions.`,
    ],
    CRM: [
      'The problem we had with standalone CRM was that the important conversations about a deal happened outside it, usually in Slack.',
      'We could open the record in HubSpot or Salesforce, but still had to message the person working on it to find out what was actually going on.',
      'At first we blamed ourselves for not keeping everything updated. Then we realized the problem was the tool itself.',
      'Macro CRM connects customer records directly to [[Macro Mail]] and [[Macro Chat]]. It’s so easy to @mention a record that you actually will. Those conversations stay linked to the customer, and [[Macro Agents]] help keep the records up to date so you don’t have to.',
    ],
    Agents: [
      'You shouldn’t have to re-explain your company every time you open a new chat—or switch work software every time a better model drops.',
      '[[Macro Agents]] share one team-wide memory built from your [[Macro Mail]], [[Macro Chat]], [[Macro Docs]], [[Macro Tasks]], and [[Macro Calls]]. Switch models inside Macro or connect Claude Code, Codex, and Cursor over MCP—your memory stays portable in plain markdown.',
    ],
    Calendar: [
      'Checking work, personal, and teammate availability across Google and Microsoft shouldn’t turn every meeting into a five-message back-and-forth.',
      '[[Macro Calendar]] puts all your accounts in one fast view right beside [[Macro Chat]]. Ask [[Macro Agents]] in a channel to find an open slot and send the invite—while teammates control whether they share full details or busy blocks.',
    ],
    Drive: [
      'The file you need is usually already in your company—you just can’t remember if it was an email attachment, a Slack upload, or buried in Google Drive.',
      '[[Macro Drive]] pulls attachments from [[Macro Mail]] and [[Macro Chat]] alongside your [[Macro Docs]] and [[Macro Spreadsheets]] into one searchable workspace. Organize into folders when you want, without relying on manual filing to find anything.',
    ],
    GitHub: [
      'A GitHub diff shows *what* changed, rarely *why*—that part is buried in a customer email or a Slack thread. Meanwhile the PR merged yesterday and the ticket still says “In progress.”',
      'Macro brings [[Macro GitHub]] pull requests beside [[Macro Chat]], [[Macro Mail]], and [[Macro Tasks]]. Review diffs in split screen, merge from the channel, and let PR events move your task statuses automatically.',
    ],
    Spreadsheets: [
      'Asking AI to help with a spreadsheet shouldn’t mean exporting a CSV, uploading it to a chatbot, and pasting cells back in.',
      '[[Macro Spreadsheets]] lets people and [[Macro Agents]] work in the same sheet—pulling live numbers from your [[Macro Mail]], [[Macro Docs]], and [[Macro CRM]] alongside full formulas, charts, and Excel/CSV compatibility.',
    ],
    Databases: [
      'We liked how easy Notion makes it to put information in a table. We also wanted the structure of a real database, without building an internal app just to track applicants, vendors, or projects.',
      'Macro Databases are good when you want to track and sort things by their properties. Use typed fields, formulas, and related tables, and link each record to [[Macro Docs]], [[Macro Tasks]], and [[Macro Mail]].',
    ],
    Forms: [
      'Collecting a form submission is easy; the annoying part is piping answers into a tracker, checking qualification rules, and sending a scheduling link afterward.',
      '[[Macro Forms]] writes every submission straight into [[Macro Databases]], qualifies leads automatically, and hands them off to [[Macro Booking Links]]—with [[Macro Agents]] able to build and edit the form for you.',
    ],
    Canvas: [
      'Whiteboards are great for sketching a plan, until the diagram goes stale because nobody updates it alongside the real project.',
      '[[Macro Canvas]] puts live @mentions of [[Macro Tasks]], [[Macro Docs]], [[Macro Mail]], and [[Macro Calls]] right on the board. Task cards show live status and open the real work in one click.',
    ],
    Snippets: [
      'Every team copy-pastes the same support replies, onboarding checklists, and prompts—and outdated versions keep circulating forever.',
      '[[Macro Snippets]] are shared markdown blocks stored in [[Macro Drive]]. Type ; in [[Macro Docs]], [[Macro Chat]], [[Macro Tasks]], or agent prompts to insert one—update the snippet once and everyone gets the latest version.',
    ],
    'Booking links': [
      'Standalone tools like Calendly mean another subscription and scheduling data disconnected from the rest of the relationship.',
      '[[Macro Booking Links]] lives beside [[Macro Calendar]], [[Macro Mail]], and [[Macro CRM]]. Book solo, collective, or round-robin meetings, gate them with [[Macro Forms]], and see every guest’s answers right on their company record.',
    ],
    Routines: [
      'Wiring Zapier across five separate SaaS tools means maintaining brittle triggers, polling loops, and mismatched data schemas.',
      '[[Macro Routines]] runs [[Macro Agents]] directly on Macro’s unified event system. Kick off work when [[Macro Mail]] arrives, [[Macro Tasks]] change status, or [[Macro Calls]] end—with schedules as just another trigger.',
    ],
    Skills: [
      'Getting reliable output from an agent shouldn’t mean every teammate pasting their own slightly different prompt into every new chat.',
      '[[Macro Skills]] are reusable markdown playbooks stored in [[Macro Drive]]. Write your code-review checklist or release-notes format once, attach it with / or let [[Macro Agents]] load it automatically, and improve it in one place.',
    ],
  };
