# In-app feature tours

Desktop list views automatically show a floating feature tour until dismissed. Tours
reopen on every view mount in localhost development for repeatable testing; dismissal
still closes the current tour but does not change saved preferences. Production keeps
per-user, per-view dismissal. Local testing also works on 127.0.0.1 and IPv6 loopback. Tours
are not mounted on narrow screens or primary touch devices, including their videos
and highlights. There is no Explore button or reserved row. A single-border card with a
soft shadow sits beside the current feature, preferably to its right, and a subtle
outline highlights the feature. Placement stays within the viewport and owning split;
Home's first card sits to the right of the list. The tour does not take focus or block
the surrounding UI. Next and Back move to the appropriate target; scroll, resize,
and newly mounted controls update its position without an idle animation loop.
Agents steps reveal the real agent management view, explain model selection and team
sharing, and point at Create for automations. Channels covers channels/DMs, creation,
threads, @mentions, and calls; select a conversation to highlight its in-context controls.
Channels does not show a Slack connection action. Email highlights Signal/Noise,
Tags (manual or agent-assisted, including automations), then keyboard shortcuts.
Customers starts at Board/List, then covers relationship details and company views.
Calendar covers multiple accounts, source visibility, copying availability, calendar
views, and event details. If a feature is unavailable (such as no connected calendar),
the tour explains how to reach it instead of highlighting an unrelated control. Clicking outside
keeps it open. The ×, Got it, or Escape while focused inside dismisses it for that
user and view on this browser; other views retain their own tours. Changing views
starts the appropriate guide at its first step. Connection suggestions inside the
flyover open Email or Connected settings. Tasks also exposes Import from Linear,
which opens the existing CSV importer. Home, Email, Documents, Tasks, Channels, Customers, and Calls include matching
videos from Macro’s YouTube channel. Click Watch to load and play the video inside
the flyover; no YouTube iframe loads before that click. The player offers fullscreen,
a YouTube link, and a Close video button. Dismissing the tour removes the player.
Guides without a matching video omit the video footer.
