# In-app feature tours

Tours are behind the `enable-in-app-tours` PostHog flag, including on the
local dev server; set `VITE_ENABLE_IN_APP_TOURS=true` to turn them on locally. With it on, desktop views show a
floating feature tour until it is dismissed: Home, Email,
Documents, Tasks, Channels, Calendar, Customers, Agents, Calls, and Folders. Tours
are not mounted on narrow screens or primary touch devices, including their videos
and highlights.

## What you see

- A card sits beside the current feature, preferably to its right, and a thin
  outline highlights the feature. The card stays inside the viewport and the
  view's split. It doesn't take focus or block the rest of the UI; clicking
  outside keeps it open.
- The header shows the feature name and Back / `n / total` / Next. The footer
  has a ghost Dismiss button beside the primary button, which reads Next, then
  Got it on the last step.
- A step with nothing to point at floats at the top right of the split. When a
  feature isn't set up (for example, no connected calendar, or only one
  calendar), the step points at the nearest real surface instead and adds a
  short hint on how to enable it.
- The card fades and rises in place when it first appears; it glides only
  when moving between steps.
- **Beacons.** A tour never navigates or opens things for you. When a step's
  feature is behind something (a collapsed sidebar, another page, an unopened
  conversation), the card hides and a pulsing dot marks the control that
  reveals it: the sidebar toggle, the Agents nav item, New conversation, or the
  top conversation row. A small card beside it says what to do ("Open a
  channel or DM to continue"), with Skip below to move on. If that control is itself in a collapsed
  sidebar, the dot marks the sidebar toggle first, then moves once the
  sidebar opens. The dot stays until the feature itself is on screen, however
  you get there; then the card appears at it. Leaving again brings the dot back.

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
channel; no player loads until Watch is clicked. The player has an × above it
to close the video, and dismissing the tour removes it.

## Progress

Progress is saved to the user's account, so it follows them across browsers
and devices. Got it on the last step (or skipping past it) saves the tour as
completed; Dismiss, or Escape while focus is inside the card, saves it as
dismissed. Either keeps it hidden. An unfinished tour resumes at the step last
reached. Other views keep their own tours.

A tour appears only after progress has loaded, and not at all if it can't
load. Progress older builds kept in this browser's local storage is uploaded
the first time a tour loads. On localhost, 127.0.0.1, and IPv6 loopback in
development, tours start from the first step on every mount and saved progress
is left alone.
