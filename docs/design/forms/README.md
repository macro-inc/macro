# Macro Forms

Forms are Google-Forms-style questionnaires whose answers land as rows in a
Macro Database. This folder is the design record for the first pass. Read the
three RFCs in order; each one makes its decisions explicit and names the code
it builds on.

| RFC | Covers |
| --- | --- |
| [01 Domain and storage](01-domain-and-storage.md) | The `forms` crate, its tables, access, how a submission becomes a database row, HTTP routes, events. |
| [02 Web](02-web.md) | Entity registration, the builder, the respond page, the Responses tab, sharing, how it all stays "one table". |
| [03 Channels and polls](03-channels-and-polls.md) | Mentioning a form, posting it with view access, filling it inline, `/poll`. |

The mockups these RFCs describe:

- Builder, Responses, Share, in-channel: https://claude.ai/code/artifact/dcaab8f5-11ec-45f1-a00c-3c26727a1f7d
- Respondent side, gate stop, confirmation, public link, phone: https://claude.ai/code/artifact/8c1be1d6-e835-4911-a2ee-dc1a94e744bf

## The model in one paragraph

A form is an entity with its own access that points at one table of one
database. The table is the schema: every question is a column, and the form
stores only presentation (sections, order, help text, required, widget hints,
gate rules). Creating a form creates a database; creating a form from a
database makes a question per column. Editing a question in the builder is a
`DatabaseOp` batch on the table, the same write surface the grid uses. A
submission is validated and gated by the forms service, then written as one
`Rows::Insert` under an internal receipt, because respondents hold at most view
on the form and never anything on the database. The form's Responses tab is the
linked table's grid, embedded.

## What the first pass leaves out

Decided, not forgotten:

- Calendar integration (free/busy slot questions, booking). Later pass.
- Branching ("after section 2 go to section 4 if…"). Sections are linear; a
  gate section can stop a submission.
- Drafts saved server-side. A response is one submit; the client keeps unsent
  answers in memory.
- Anonymous respondents editing their response.
- File upload on public forms (anonymous upload is impossible today).
- AI tools and MCP tools for forms.
- Linking a database table into a spreadsheet (separate work).
