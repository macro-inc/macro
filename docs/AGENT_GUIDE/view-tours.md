# In-app feature tours

Desktop views show a floating feature tour until it is dismissed: Home, Email,
Documents, Tasks, Channels, Calendar, Customers, Agents, Calls, and Folders. Tours
are not mounted on narrow screens or primary touch devices, including their videos
and highlights.

## What you see

- A card sits beside the current feature, preferably to its right, and a thin
  outline highlights the feature. The card stays inside the viewport and the
  view's split. It doesn't take focus or block the rest of the UI; clicking
  outside keeps it open.
- The header shows the tour name, Back / `n / total` / Next, and ×. The footer
  button reads Next, then Got it on the last step.
- A step with nothing to point at floats at the top right of the split, with a
  short hint when the feature is unavailable (for example, no connected calendar).
- **Beacons.** A tour never navigates or opens things for you. When a step's
  feature is behind something (a collapsed sidebar, another page, an unopened
  conversation), the card hides and a pulsing dot marks the control that
  reveals it: the sidebar toggle, the Agents nav item, New conversation, or the
  channel list. Pressing that control, or reaching the feature any other way,
  clears the dot and shows the step. Leaving again brings the dot back.

## Per view

- **Agents:** agent and model picker (beacon on New conversation), then the
  agents and Runtimes tabs (beacon on Agents), then Create for automations.
- **Channels:** channels and DMs, creation, then threads, @mentions, and calls,
  which wait on the channel list until a conversation is open. No Slack action.
- **Email:** Signal/Noise, tags, then keyboard shortcuts.
- **Customers:** Board/List, relationship details, then company views.
- **Calendar:** calendar sources and copy availability (beacon on the sidebar
  toggle while the sidebar is collapsed), calendar periods, then event details.
- **Tasks:** also offers Import from Linear, which opens the CSV importer.

Connection suggestions open Email or Connected settings. Home, Email, Documents,
Tasks, Channels, Customers, and Calls include a video from Macro's YouTube
channel; no player loads until Watch is clicked, and dismissing removes it.

## Dismissal

×, Got it, or Escape while focus is inside the card dismisses the tour for that
user and view on this browser; other views keep their own tours. On localhost,
127.0.0.1, and IPv6 loopback in development, tours reopen on every mount and
dismissal doesn't change saved preferences.
