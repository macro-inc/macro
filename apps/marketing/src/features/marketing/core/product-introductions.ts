/**
 * Product introductions, based on the founder's README and product guides.
 * [[Macro Routines]] renders as that product's linked mention, and *asterisks*
 * italicize a word.
 */
export const productIntroductions: Partial<Record<string, readonly string[]>> =
  {
    Workspace: [
      'Most startups end up paying for Slack, Linear, Notion, HubSpot, Superhuman, and Calendly and still spend half their week copying links between them.',
      'We built Macro to replace those subscriptions with [[Macro Mail]], [[Macro Chat]], [[Macro Docs]], [[Macro Tasks]], [[Macro CRM]], and [[Macro Agents]] in one workspace so your software bill drops and your work actually stays connected.',
    ],
    'Company graph': [
      'A task almost never makes sense on its own because the real story is usually sitting in a customer email, a chat thread where someone debated the fix, or a spec doc.',
      'In Macro every @mention links both ways across [[Macro Mail]], [[Macro Chat]], [[Macro Docs]], and [[Macro Tasks]]. When you open a task you can jump right back to the email or pull request that started it without tracking anyone down for background.',
    ],
    'AI tagging': [
      'Most tools make you maintain separate folders and labels everywhere: Gmail labels in one tab, Linear labels in another, and Google Drive folders in a third. Nobody has time to keep them matching.',
      'Macro shares one set of tags across [[Macro Mail]], [[Macro Tasks]], [[Macro Docs]], and [[Macro Drive]]. Your [[Macro Agents]] and [[Macro Routines]] can tag incoming work by customer, topic, or urgency so one click pulls up everything related.',
    ],
    'Automatic permissions': [
      'You’ve probably run into this: you share a Google Doc link in Slack only to get a ping back saying “Hey, I can’t open it.” The problem is that permissions live outside your channels. What if permissions were granted the moment you shared something just like attaching a file to an email?',
      'Access in Macro follows [[Macro Chat]] membership. Share a doc, email, or task in a channel and everyone in it can open it. New teammates get the history on day one and people who leave lose access automatically.',
    ],
    'Workspace events': [
      'We want agents to be able to help when something happens at our company... but how do you know “when something happens”?',
      'If your company is spread across a bunch of software tools, there is no event system. Your agents have to constantly poll every business system to see what’s been updated and many tools don’t even expose MCPs for events!',
      'In Macro there are events for everything (customer email arriving in [[Macro Mail]], an @mention in [[Macro Chat]], or status changes in [[Macro Tasks]]) on one *unified* event bus so your agents only subscribe to one feed and [[Macro Routines]] can kick off when things happen.',
    ],
    'Unified search': [
      'You usually remember what a customer asked for rather than whether they said it in an email, a Slack thread, or on last Tuesday’s call.',
      'Macro indexes [[Macro Mail]], [[Macro Chat]], [[Macro Docs]], [[Macro Tasks]], [[Macro Drive]], and [[Macro Calls]] together in one search index. Both your team and [[Macro Agents]] search the same workspace and get linked sources back right away.',
    ],
    Email: [
      'There have been a million email clients that each did something well but none that had everything we wanted: superhuman speed, all our accounts in one inbox, auto-organization, and [[Macro Agents]] with frontier intelligence.',
      'Macro Mail does all of that. It makes email collaborative inside [[Macro Chat]], links threads straight to [[Macro Tasks]], and updates your [[Macro CRM]] automatically.',
    ],
    Tasks: [
      'Task trackers go stale fast when they live separately from [[Macro GitHub]] and your customer conversations because updating tickets by hand is too much friction.',
      'We designed [[Macro Tasks]] so you can create tasks right from [[Macro Chat]] or [[Macro Mail]] or let [[Macro Agents]] spin them up for you. Assign a task to a teammate or hand it to an agent to write the code or draft the deliverable.',
    ],
    Chat: [
      'Moving from Slack to a separate chatbot means re-explaining the whole thread and then pasting the answer back for everyone else. We built [[Macro Chat]] so your team and [[Macro Agents]] can work in the same conversation from the start.',
      'You can share threads from [[Macro Mail]], link [[Macro Docs]], and turn any message into [[Macro Tasks]] right inside a channel. Inline threads and Signal/Noise triage keep conversations readable so bringing agents into chat cuts down on noise instead of adding to it.',
    ],
    Docs: [
      'We really liked how Obsidian keeps everything in plain markdown that our agents can easily read and edit, and we liked how Notion handles @mentions and live team collaboration. We just didn’t want to pick one or get locked into a proprietary format and a single vendor’s AI.',
      '[[Macro Docs]] puts people and [[Macro Agents]] in the same live markdown editor and routes edits through a nearby server so typing together feels instant. You can @mention [[Macro Tasks]], [[Macro Mail]], and [[Macro Calls]] right in the page, keep writing offline, and export plain markdown whenever you want.',
    ],
    Calls: [
      `A lot of the important context in a company is spoken and until we have robots in the room with us it doesn't make it to our agents. Macro Calls fix this by injecting everything your team says into team-level memory. Your coding agents know about what was said at standup. Your marketing agents know about the idea kicked around on a call. All of this "just works" without sharing calls and worrying about permissions.`,
    ],
    CRM: [
      'The problem we had with standalone CRM was that the important conversations about a deal always happened outside it in Slack.',
      'We could open the record in HubSpot or Salesforce and still have to message the person working on it to find out what was actually going on.',
      'At first we blamed ourselves for not keeping everything updated. Then we realized the problem was the tool itself.',
      'Macro CRM connects customer records directly to [[Macro Mail]] and [[Macro Chat]]. It’s so easy to @mention a record that you actually will. Those conversations stay linked to the customer and [[Macro Agents]] keep the records up to date so you don’t have to.',
    ],
    Agents: [
      'It gets old re-explaining your company every time you open a new chat window and you don’t want to switch work tools every time a better model comes out.',
      '[[Macro Agents]] share one team memory built from your [[Macro Mail]], [[Macro Chat]], [[Macro Docs]], [[Macro Tasks]], and [[Macro Calls]]. You can switch models right inside Macro or connect Claude Code, Codex, and Cursor over MCP while keeping your memory portable in plain markdown.',
    ],
    Calendar: [
      'Coordinating across work, personal, and teammate calendars on Google and Microsoft usually turns a simple meeting into five back-and-forth messages.',
      '[[Macro Calendar]] puts all your accounts into one fast view right beside [[Macro Chat]]. You can ask [[Macro Agents]] in a channel to find an open slot and send the invite while everyone still controls whether teammates see full event details or just busy blocks.',
    ],
    Drive: [
      'Half the time the file you’re looking for is already somewhere in your company, you just can’t remember if it came in an email, a Slack upload, or a Google Drive folder.',
      '[[Macro Drive]] gathers attachments from [[Macro Mail]] and [[Macro Chat]] alongside your [[Macro Docs]] and [[Macro Spreadsheets]] in one searchable place. You can organize things into folders whenever you want without relying on manual filing to find anything later.',
    ],
    GitHub: [
      'A GitHub diff shows you *what* changed in the code, not *why* you made the change. That part usually lives in a customer email or a chat thread, and meanwhile the PR merged yesterday while the ticket still says “In progress.”',
      'Macro brings [[Macro GitHub]] pull requests right next to [[Macro Chat]], [[Macro Mail]], and [[Macro Tasks]]. You can read diffs in split screen, merge straight from the channel, and let PR updates move your task statuses automatically.',
    ],
    Spreadsheets: [
      'Getting help from AI on a spreadsheet usually means exporting a CSV, uploading it to a chat window, and copying cells back in by hand.',
      'With [[Macro Spreadsheets]] your team and [[Macro Agents]] edit the exact same sheet together. Pull live context from [[Macro Mail]], [[Macro Docs]], and [[Macro CRM]] alongside normal formulas, charts, and Excel or CSV imports.',
    ],
    Databases: [
      'We liked how easy Notion makes it to put information in a table. We also wanted the structure of a real database without building an internal app just to track applicants, vendors, or projects.',
      'Macro Databases are good when you want to track and sort things by their properties. Use typed fields, formulas, and related tables. Link each record straight to [[Macro Docs]], [[Macro Tasks]], and [[Macro Mail]].',
    ],
    Forms: [
      'Collecting answers with a form is easy enough. The annoying part is wiring up scripts to push responses into a tracker, check qualification rules, and send out a scheduling link afterward.',
      '[[Macro Forms]] sends every submission straight into [[Macro Databases]], filters leads with your rules, and hands qualified guests directly to [[Macro Booking Links]]. You can also ask [[Macro Agents]] to create and update the form for you.',
    ],
    Canvas: [
      'Whiteboards are great when you’re first sketching out a plan until the diagram goes stale a week later because nobody updates it alongside the real project.',
      '[[Macro Canvas]] lets you drop live @mentions of [[Macro Tasks]], [[Macro Docs]], [[Macro Mail]], and [[Macro Calls]] straight onto the board. Task cards keep showing their current status and open the real work in one click.',
    ],
    Snippets: [
      'We kept copying and pasting the same support replies, onboarding checklists, and agent prompts across the team and old versions kept floating around for months.',
      '[[Macro Snippets]] are shared markdown blocks stored in [[Macro Drive]]. Type ; inside [[Macro Docs]], [[Macro Chat]], [[Macro Tasks]], or an agent prompt to drop one in. Whenever you update the snippet once, everyone automatically gets the latest version.',
    ],
    'Booking links': [
      'Using a standalone scheduler like Calendly means another subscription to pay for and booking notes that sit disconnected from the rest of your customer history.',
      '[[Macro Booking Links]] lives right beside [[Macro Calendar]], [[Macro Mail]], and [[Macro CRM]]. You can book solo, collective, or round-robin meetings, put [[Macro Forms]] in front to qualify requests, and see every guest’s answers on their company record.',
    ],
    Routines: [
      'Hooking Zapier up across five different SaaS tools usually ends up as a pile of fragile automations, polling delays, and broken fields whenever something changes.',
      '[[Macro Routines]] runs [[Macro Agents]] directly on Macro’s event system. You can kick off work whenever [[Macro Mail]] arrives, [[Macro Tasks]] change status, or [[Macro Calls]] wrap up, or run any routine on a plain-English schedule.',
    ],
    Skills: [
      'Getting consistent results from an agent gets frustrating when everyone on the team is pasting their own slightly different prompt into every new chat.',
      '[[Macro Skills]] are reusable markdown guides stored right in [[Macro Drive]]. Write your code-review checklist or release-notes format once, refine it in one place, and either attach it with / or let [[Macro Agents]] pick it up on their own.',
    ],
  };
