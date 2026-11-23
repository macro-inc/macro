---
description: "UI copy adds helper text only for context the label can't carry: consequences, ambiguity, recovery, or prerequisites."
paths:
  - "apps/web/src/**/*.tsx"
  - "apps/web/src/lib/i18n/locales/**/*.ts"
globs: "apps/web/src/**/*.tsx,apps/web/src/lib/i18n/locales/**/*.ts"
alwaysApply: false
---

# Write helper copy only when the label can't say it

A description that restates its label is noise the reader has to skip, and it
crowds out the helper text that does matter.

- **FE-73** Omit descriptions, helper text, and tooltips that repeat a clear
  label or say what the control obviously does. A visible label needs no
  tooltip; an icon-only control gets one naming it (FE-24).
- **FE-74** Add helper copy only for material context: a consequence the label
  hides, a choice that is otherwise ambiguous, how to recover, or a
  prerequisite.

Don't:

- Under **Dictate**, "Type what you say into the message"; under **Voice
  memo**, "Send a recording of your voice" (#11903 removed both).
- A tooltip "Open in channel" on the labelled **Open in channel** button; keep
  it only on the phone's icon-only form (#11651).

Do:

- **Remove {name}?** on a team agent, with "Its computer and files are
  deleted. This can't be undone.": the consequence the label hides
  (`teamAgents.removeBody`).
- The composer note while an agent waits: "The agent is waiting for your answer
  above; Skip lets it continue without one. Messages sent now are queued."
  It explains a state and what sending does in it (#11628).

Check: read each new or changed description, helper line, and tooltip; delete
it if it only restates its label or the control's obvious action.
