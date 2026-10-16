# UI conventions

## Home list loading

Home shows compact row skeletons during initial loading, with taller notification
placeholders on touch devices. Date grouping includes a placeholder heading.
Pagination appends three placeholders without replacing existing items; refresh
keeps loaded items visible. Wait for real rows before navigating or selecting.

## Top bars

Low-emphasis right-aligned split-header actions (including Calendar's touch/preview
New event and Channel's idle Call and Ask Macro) are borderless with a rounded-xl
background on hover. Emphasized variants retain their treatment, including an
active call's green ink and outline frame. Channel, company, contact, and project
content tabs use inset controls in the top bar. Button sizes do not change variant colors or framing; individual
framed controls default to glass on touch and flat on desktop. Use `glass={true}`
to enable glass on all devices, or `glass={false}` to disable it everywhere.
Embedded and low-emphasis actions use `ghost`; inline calendar-invitation text
actions remove the transparent border to keep their text alignment.

## Dialog actions

Cancel uses a ghost button. Confirm, save, and create actions use strong: the
outline surface and border with semibold text, without inverted colors. Disabled
and pending primary actions retain the strong variant. Mobile confirmation drawers
use the same action hierarchy.

## List-item sharing

Right-click a shareable list row and choose **Share**. The sharing dialog must
remain open after the context menu closes, with recipient selection and the
optional message available. Dismiss it with Cancel, then reopen Share on the
same row and confirm focus enters the recipient selector again. Opening or
cancelling the dialog does not change access; do not submit shares on real dev
data unless authorized.

## User cards

Avatar and user-mention cards open on hover on pointer devices and as a bottom
sheet on touch devices. With a keyboard on a touch device, Tab to the trigger and
press Enter or Space; verify focus enters the sheet and returns to the opener
after dismissal or copying, including after reopening. DM, Open contact, and
Assign task should leave focus in their destination when the sheet closes.
On pointer devices, avatars should stay out of the Tab order while still opening
their cards on hover. Copy email/name confirms only after the clipboard
write succeeds: the hover card shows a checkmark, while the sheet closes. A failed
write shows failure feedback and leaves the card open for retry.

## Floating block information panels

Actions live in the top bar immediately before Share, with consistent compact
buttons (labels collapse on narrow headers). There are no Actions sections in
information panels. Markdown/tasks include Ask Macro and document/task dispatch; email
includes Ask Macro and Create task; PDF and calls include Ask Macro. Native
projects put Delete in the `Project actions` menu after the project title.

Standard metadata is quiet, non-collapsible text at the bottom of each panel,
separated by a muted divider. Owner and available timestamps share one format;
Markdown adds word/character counts. There is no standard Details or Stats
disclosure. Agent runtime information remains in its dedicated Session section.

Block information panels float over the right side of the block without changing
the content width or its centered position. A single rounded bubble fits its
contents, with `edge-muted` dividers between sections. Its height is capped at
the block height with internal scrolling. At every width it starts closed and
acts as a split-local overlay menu on desktop. The top-right sidebar icon, rotated
180 degrees, opens it, and clicking outside dismisses it. On touch devices the
control uses the Phosphor info-circle icon and opens the standard bottom drawer
with a drag handle, scrollable sections, and safe-area/keyboard-aware spacing.
Dismiss the drawer by swiping down or tapping its backdrop. Opening is never
restored from saved preferences or triggered by the global chrome shortcut. The 320px bubble enters
with a slight slide from the right and a 120ms fade;
closing fades it out in 70ms.
This applies across Markdown/tasks,
snippets, email, calls, agents, pull requests, projects, and all file blocks
including PDFs, images, code, video, canvas, unknown file types, and CRM company
and contact views (both inside the CRM workspace and in standalone blocks).
