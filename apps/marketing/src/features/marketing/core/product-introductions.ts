/**
 * Product introductions, based on the founder's README and product guides.
 * [[Macro Routines]] renders as that product's linked mention, and *asterisks*
 * italicize a word.
 */
export const productIntroductions: Partial<Record<string, readonly string[]>> =
  {
    Workspace: [
      'We wanted to bring the company’s work into one place without making people settle for a worse email client, document editor, or task manager. Each part has to be good on its own. The reason to put them together is that the work already belongs together.',
      'Macro replaces separate subscriptions with a connected workspace for people and agents. A customer email can become a task, link to a discussion, and stay attached to the customer record. You save on software, but you also spend less time moving information between tools and explaining it again.',
    ],
    'Company graph': [
      'A task rarely makes sense on its own. There’s a customer email behind it, a conversation about what to do, and a document with the details. We wanted those connections to stay attached to the work, so the next person or agent could follow them without asking someone to explain everything again.',
      'In Macro, links work both ways. @mention a document in chat and its References panel shows that conversation. Create a task from an email and you can get back to the original request. The context builds up as your team works.',
    ],
    'AI tagging': [
      'Organizing work becomes another job when every app has its own labels and folders. We wanted one set of tags across the company, with agents doing the repetitive sorting. A customer’s emails, tasks, and meeting notes should be easy to find together.',
      'Macro tags work across your workspace. Set up a routine to tag incoming email or new tasks by customer, topic, or urgency, then use those same tags to find related work. Your team shares the tags, so everyone can use the same organization.',
    ],
    'Automatic permissions': [
      'You’ve probably run into this: you share a link to, say, a Google Doc in Slack, only to receive a ping back: “Hey, I can’t open it.” The problem is that permissions are separate from channels. But what if permissions were granted when you shared anything, just like attaching a file to an email?',
      'In Macro, access follows channel membership. Share a document, email, or task in a channel and its members can open it. New members get that context too; people who leave lose the access that channel gave them. You can still manage access to an individual item from Share.',
    ],
    'Workspace events': [
      'We want agents to be able to help when something happens at our company... but how do you know “when something happens”?',
      'If your company is spread across a bunch of software tools, there is no event system. Your agents have to constantly poll every business system to see what’s been updated, and many tools don’t even expose MCPs for events!',
      'In Macro, not only are there events for everything — customer email comes in, an @mention in a channel, a task updated — there’s a *unified* event bus for everything, so your agents only have to subscribe to one feed, and so [[Macro Routines]] can kick off when things happen.',
    ],
    'Unified search': [
      'You can remember what someone said without remembering whether it was in an email, a document, or a call. We wanted one place to look. Agents need that too: finding the right context shouldn’t depend on guessing which app to search first.',
      'Macro searches emails, messages, documents, tasks, and calls together. People and agents search the same workspace, with timestamps and links back to the original work. Find the customer’s request, follow the discussion, and see what happened next.',
    ],
    Email: [
      'There have been a million email clients, each doing something well, but none felt like the complete package to us. We wanted superhuman speed, all our accounts in one inbox, and agents that could help without us copying everything into ChatGPT.',
      'Macro Mail brings those pieces together. Your emails are connected to your team’s conversations, tasks, and customer records. Share a thread in chat, turn a request into a task, or ask an agent to draft a reply using the context already in your workspace.',
    ],
    Tasks: [
      'The problem with traditional task managers is that they quickly get out of date because they’re not properly linked “to the work” e.g. github or the real world, and because it’s too much friction to update them manually',
      'Macro Tasks are auto-created where you already work: in your team chat, from an email, or in the background via ambient agents. No need to go to ever create or organize tasks manually. They’re also built natively for human-agent teams: you can assign tasks to agents and they’ll write the code, or complete the creative, or to a human.',
    ],
    Chat: [
      'We wanted agents to be actual participants in the team: able to follow a discussion, find the relevant context, and do the work. Moving from Slack to a separate chatbot meant explaining the conversation again, then pasting the result back for everyone else. We wanted people and agents working in the same conversation from the start.',
      'Macro Chat is built for people and agents working together. Bring an agent into a channel where the tasks, emails, and documents are already @linked, and it can work from the same context as your team. We also wanted chat to be more focused than Slack: replies stay organized in threads, and AI helps separate what needs your attention from the noise. Adding agents should help your team get through the work, not give everyone more messages to read.',
    ],
    Docs: [
      "We wanted a great writing surface without having to choose between markdown, collaboration, and agents. Obsidian showed us the value of plain markdown that our own agents could work with, but we also wanted live team editing. We liked parts of Notion, but didn't want our documents tied to its format or our agent workflow tied to its AI. We wanted markdown, our choice of agents, version history, and collaboration in one place.",
      "Macro Docs gives people and agents the same live document to work on. It uses CRDTs, which merge edits from multiple collaborators, and routes editing through a nearby server so edits feel like you're on the same computer. Documents are @linked to the rest of your work, and agents can edit alongside you or update them in the background. And when you just want to write, it's a clean, responsive editor. You don't need to use AI to get a good writing tool.",
    ],
    Calls: [
      'A lot of the important context in a company is spoken, not written. Somebody explains what the customer actually needs on a call, but the rest of the team gets a few bullet points, and the agent gets nothing. We wanted more than a recording to look up later: we wanted what happened on the call to inform the next piece of work.',
      "Macro Calls feed into team memory. Start a call from your channel, and the recording, transcript, and summary stay in your workspace. Calls shared with the team become context your agents can use when drafting a follow-up, updating a document, or working through a task. You don't have to explain the meeting again to get useful work out of it.",
    ],
    CRM: [
      'The problem we had with standalone CRM was that the important conversations about a deal happened outside it, usually in Slack.',
      'We could open the record in HubSpot or Salesforce, but still had to message the person working on it to find out what was actually going on.',
      'At first we blamed ourselves for not keeping everything updated. Then we realized the problem was the tool itself.',
      'Macro CRM connects customer records directly to your email and team chat. It’s so easy to @mention a record that you actually will. Those conversations stay linked to the customer, and agents help keep the records up to date so you don’t have to.',
    ],
    Agents: [
      "We wanted agents that could actually work inside the company, with the context and tools a teammate would have. We also didn't want to choose our work software based on which model happened to be best that month. Your team's knowledge and workflows should carry across models and agents, instead of starting over in each chatbot.",
      'Macro Agents combine shared team memory with the ability to act across your workspace. They can work with your emails, documents, tasks, and calls, using memory built from the work itself. Choose a model inside Macro or connect your own agents through MCP. The same context is available either way, and your memory is stored in markdown so you can take it with you.',
    ],
    Calendar: [
      'Scheduling gets awkward when your availability is spread across Google and Microsoft accounts, with work, personal, and shared calendars in the mix. Finding time with the team becomes a separate conversation about the conversation you actually want to have. We wanted to ask for a time where we were already discussing the work.',
      "Macro Calendar brings your Google and Microsoft accounts into one view. Ask an agent in a channel to find a time with your teammates, and it can check the availability they've chosen to share, then help send or edit the invite. You control whether teammates see event details, busy blocks, or nothing. Scheduling happens in the same place as the conversation leading up to it.",
    ],
    Drive: [
      'The file you need is often already somewhere in your company. The problem is remembering whether it arrived as an email attachment, was posted in Slack, or was uploaded to Google Drive. Manually filing everything is another job that falls behind. We wanted to find a file without first remembering how it got to us.',
      "Macro Drive brings those files into the same searchable workspace. Attachments from email and channels are imported alongside your documents, spreadsheets, and other files, so you and your agents can find them without hunting through the original thread. You can still organize things into folders, but finding a file doesn't depend on somebody having filed it correctly.",
    ],
    GitHub: [
      "A GitHub pull request tells you what changed in the code, but not always why the work mattered in the first place. That context is in a customer email, a task, or a team conversation. Meanwhile, the code has shipped but the task still says 'In progress' because nobody remembered to update it.",
      'Macro brings GitHub pull requests into the same system as the work behind them. Read the diff and discussion, follow the linked task, or @mention the PR in a channel. Linked tasks move through progress, review, and completion as the branch and pull request move forward. The status follows the code, and the reasoning stays attached to it.',
    ],
    Spreadsheets: [
      "Google Sheets made spreadsheets collaborative. We wanted to take that further: people and agents working on the same spreadsheet, with access to the context behind the numbers. Asking an agent to help shouldn't mean exporting a file, uploading it to a chatbot, and copying the result back into the sheet.",
      'Macro Spreadsheets let agents read, calculate, and edit alongside your team. They can work on selected cells, build a sheet, or update one through a routine, using the emails, documents, and conversations in your workspace as context. You still get the spreadsheet fundamentals: formulas, charts, and Excel and CSV import and export, without the separate workflow for agentic work.',
    ],
    Databases: [
      'We liked how easy Notion makes it to put information in a table. We also wanted the structure of a real database, without building an internal app just to track applicants, vendors, or projects.',
      'Macro Databases are good when you want to track and sort things by their properties. Use typed fields, formulas, and related tables, and link each record to the docs, tasks, and emails behind it.',
    ],
    Forms: [
      'Collecting a response is the easy part. We wanted the work after the form to be just as straightforward: reviewing the answers, checking whether someone qualifies, and letting them book a meeting. Moving responses from a separate form tool into a tracker is another manual handoff to maintain.',
      'Macro Forms write responses directly into a database, where your team can review and organize them. Add qualification rules and a booking link so the right people can schedule immediately after submitting. Agents can help create and edit the form, including the questions and rules, without you building the same workflow in several tools.',
    ],
    Canvas: [
      'Not every project fits neatly into a list of tasks or a document. Sometimes you need the freedom of a whiteboard to move things around and draw connections. We wanted that without creating a separate picture of the project that somebody has to keep in sync with the real work.',
      'Macro Canvas puts the real work on an infinite canvas. Draw a diagram or sketch a plan, then add live @mentions of tasks, documents, emails, and calls alongside it. Task mentions show their current status, and you can open the underlying work directly. You get the freedom of a whiteboard without having to maintain a second representation of the project.',
    ],
    Snippets: [
      "Teams rewrite the same things constantly: support replies, onboarding checklists, meeting notes, and instructions for agents. Copying an old version is quick, but it's also how outdated instructions keep circulating. We wanted a shared starting point wherever we were writing.",
      "Macro Snippets are reusable markdown you can share with your team. Type ';', find the snippet, and drop it into a document, task, message, or agent instruction. Edit the shared snippet once and future insertions use the updated version. Your team gets a common starting point without everyone keeping their own copy.",
    ],
    'Booking links': [
      'Booking links became a whole separate software category, with another subscription and another set of settings to maintain. Tools like Calendly solve the scheduling problem, but we wanted scheduling alongside the form someone fills out, their company record, and the emails leading up to the call, rather than paying for and connecting a standalone scheduling tool.',
      'Macro Booking Links bring booking into the workspace where you manage those relationships. Let someone book with you, find a time with several teammates, or route a meeting to an available host. Connect a qualification form directly to a booking link, and let agents help configure the scheduling rules. Booking, email, and CRM belong in the same customer workflow.',
    ],
    Routines: [
      'Zapier made it possible to connect separate tools, but you still have to wire together their different triggers, actions, and definitions of what happened. We wanted agents to respond to activity across the company without building a separate integration for every workflow. That starts with one events system across the workspace.',
      'Macro Routines run agents from that unified events system. An email arriving, a message in a channel, a task changing status, or a call ending can all start a routine, using the same instructions and access to your workspace. Have an agent turn an incoming request into a task or update a document after a call. A schedule is just another trigger: the useful part is that agents can respond to the work as it happens.',
    ],
    Skills: [
      'Getting a good result from an agent often means explaining how your team does things: the format you use, what to check, and what a finished result looks like. We wanted those instructions to be reusable across our work, rather than keeping a collection of prompts to paste into each new chat.',
      'Macro Skills turn those instructions into reusable documents. Write your contract-review checklist or release-notes format once, then attach it to an agent conversation or let an agent find the relevant skill. Share it with your team and update it as your process changes. Agents use the current version, so the instructions can improve without everyone maintaining their own prompt.',
    ],
  };
