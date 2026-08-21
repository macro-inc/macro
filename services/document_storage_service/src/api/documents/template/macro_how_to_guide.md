# Welcome to Macro!

Macro is an extremely fast, unified interface for all your work—email, messages, tasks, docs, and AI agents, all linked together in one database. 

We've prepared some starter docs to help you get a sense of the power of **Macro**. Press `cmd + k` to take a peek!

Let's walk around together and see what **Macro** can do. As you're reading, try playing around.

> **Tip:** We've pinned this doc to your favorites, which appears in the sidebar. For the full documentation, visit [docs.macro.com](https://docs.macro.com).

---

# Unified Input

In **Macro**, anywhere that you can type—whether it's a document, an email, a message—you have access to a host of powerful tools.

For example, you can always type @ to open the **mentions** menu. Go ahead, try it.

**Type @ here:**

Mentions allow you to create **bidirectional links** to any document, contact, channel, etc. Anything inside of Macro can be mentioned. 

For example here is **task** mention: <m-document-mention>{"documentId":"LEARN_ABOUT_TASKS_ID","blockName":"task","documentName":"LEARN_ABOUT_TASKS_NAME","blockParams":{},"collapsed":false}</m-document-mention>. And here is the same mention, rendered as a card:

<m-document-card>{"documentId":"LEARN_ABOUT_TASKS_ID","blockName":"task","documentName":"LEARN_ABOUT_TASKS_NAME","blockParams":{},"previewBox":["100%","400px"],"previewData":null}</m-document-card>

Sometimes mentioning has special powers. For example, if you mention a user in a **message** or in a **document comment**, Macro will notify that user that they've been mentioned.

> **Tip:** You can see every place that a document has been mentioned in the References sections of the document's info panel.

Other tools available wherever you are typing: 

1. `#` to add **tags,** e.g. docs
2. `/` for text formatting and other tools (try typing `/task`)
3. `:` for emojis 🦋

---

# Learn the five most important shortcuts

Macro is built to be driven from the keyboard.

- `cmd + k` — jump to anything by name
- `c` — create anything (then `d` for a doc, `t` for a task, `e` for an email, `m` for a channel, `a` for an AI chat)
- `/` — search everything in your workspace
- `j` / `k` — move down / up in any list
- `e` — mark done

> **Note:** You won't be able to use the single-letter shortcuts if you're currently editing text. Press `escape` first to unfocus the editor, and then try pressing, for example, `c`.

You'll see shortcuts for actions listed in the command menu, in tooltips when you hover buttons, or in the context menu when you right-click on an item. For a full-list of shortcuts, see [keyboard shortcuts reference](https://macro.com/app/settings/shortcuts).

---

# Documents

Press `c` then `d` to create a document. Docs are markdown-native and collaborative in real time — multiple people can type on the same line without conflicts.

Documents are *public* by default. You can click share in the corner to edit permissions or get yourself a link. Share this with a friend!

There's a bunch of other fancy stuff documents can do:

- Select text to comment; comments with @mentions always notify
- Markdown auto-formatting: `#` for headings, `[]` for checklists, `>` for quotes.
- Full version history with time-travel browsing
- Type `/` for a bunch of fun nodes. Math? $\int_{you=0}^{you=100}(Macro)dx$

---

# Triage everything from one inbox

Press `g` then `i` to open your unified **inbox**: emails, channel messages, task assignments, doc mentions, and agent results—all in one list.

- **Signal** is what needs your attention. **Noise** is everything else (newsletters, promos), filtered by AI.
- Move with `j`/`k`, preview with `space`, open with `enter`, and mark items as done with `e` to get to inbox zero.

---

# Connect *all* your email accounts

Macro is a full email client that syncs with Gmail and Google Workspace—no migration needed. Connect one or more accounts in **Settings**, and every message lands in a single unified inbox. When you compose, you pick which address sends.

---

# Put agents to work

Press `c` then `a` to chat with an agent, or mention **@Macro** in any channel. Agents see your whole workspace — docs, emails, messages, call transcripts — so they can summarize discussions, answer questions, draft documents, and create tasks. You can also schedule **automations** (daily reminders, weekly summaries) that deliver results straight to your inbox.

---

# Splits

Macro has a built-in window manager:

- `\` or `cmd+\` — split your workspace
- `shift+h` / `shift+l` — move focus between splits
- `shift+esc` — maximize the focused split
