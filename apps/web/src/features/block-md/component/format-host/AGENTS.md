# Document formatting hosts

## Scope

Adapt document formatting UI to actual Source or native capabilities. Use the
real MarkdownDocumentProvider and production document state. Never construct a
LexicalEditor, LexicalWrapperContext or Source selection facade for a native view.
Native commands use the mounted view's actual port, generation and admission.

Keep model mutation policy in the existing native command handlers. Capture UI
facts from current native queries only inside latestPublished; use mirror
ancestry only to address those queries. Release listeners and captured targets
when the view closes or its generation changes.

## Checks

Establish pristine Source browser controls before changing shared controllers or
markup, then rerun them unchanged and compare native behavior on the latest
matched artifact. Verify package and actually served compiled-map integrity.
Run TypeScript, focused tests and scoped `just check`; retain native refusals and
missing capabilities explicitly. Do not change the table semantic ledger.

The touch caret-mode browser rows (browser-test/caret-mode.caret-e2e.ts, the `?caret` pages caret-source.tsx and caret-native.tsx over caret-seed.ts) run once per engine build through caret.playwright.config.ts with CARET_ENGINE=source|native; the per-engine asserts are not parity on their own, so compare the two runs' attached caret-facts (toolbar boxes, pills, hide counts, resolved points).

Named difference C-SOURCE-CARET-LOCATION-LOG-01: Source's MarkdownPopup reads the selection location whenever its popup takes a selection, so locationPlugin.ts logs `Currently location plugin only suppotys range selections.` (console only, no user-visible effect) each time the touch caret toolbar opens on a collapsed caret; native does not. The Source rows admit exactly that message from the Source build's MarkdownPopup asset and count it per row (more than zero exactly when the toolbar opened); native admits none.

Install the actual Source restoreFocusPlugin in app-equivalent fixtures before qualifying focus-dependent dropdown controls; direct-button controls alone do not prove More-menu restoration. Defer native dropdown-close refocus until Kobalte finishes restoring its trigger, then recheck the captured host/root and current interaction policy before focusing its current published range.

Capture all native formatting query results inside the construction-time latestPublished observer and expose only those data snapshots to reactive UI. Retire presentation without native receivers; terminal key handles stay with the actual view owner until its existing close fence. Ordinary component cleanup still unregisters its actual listeners while admission permits.

Keep native FormatTools in the selected-body withinPopup path; its full-header title/body focus routing is not verified and must retain Source behavior before any broader host wiring.

Mount the native body floating menu through its construction-time publication observer and an independent optional overlay lifetime; reuse the document interaction accessor including generation, waiting and editor-error locks. Show the Source FormatTools Link button (Bold, Italic, Link, More order) in the desktop body popup (`views/body-format-popup.tsx`): without a link in the selection it opens the `link` slot prompt (Source MarkdownPopup "Paste or insert link"; `captureLink` keeps the selection, and submit inserts the link over it labelled with the selection text read at submit), and with one it unlinks. The slash Link row reaches the native link host through `requestLink`, which follows Source TRY_INSERT_LINK (create at a caret, Prepare then edit on a range) and throws before the first publication.

Co-dispose HostedFloatingLinkMenu with its actual native link host inside the overlay's FloatingMenuGroup and ErrorBoundary; registerMenu has no independent unbind. Gate interaction and deferred opening on the supplied document interaction accessor. Resolve each link menu action's target when Source does: insert, update, updateUrl and unlink send against the selection current at dispatch, never a target captured at the opening click.

Use the actual document-body call chain MarkdownPopup → FormatTools withinPopup as the body toolbar oracle. HostedFloatingFormatMenu belongs to MarkdownTextarea/Shell; its component proofs do not establish body UI admission or the six-item body More menu.

Render Comment inside NativeBodyFormatPopup, never a second toolbar: show it for commenters while the live root exists and the session draft capability is mounted, after one divider only when formatting controls are present; keep formatting gated on the host interaction accessor. Keep the popup open with the Source toast on failed insertion and close it on success.

Read expanded selection text through the generation-checked group-b.selection-text query inside latestPublished and before link preparation; never request clipboard formats on publication, keep full formats demand-driven by copy/cut/dragstart, and keep the table popup driven by its own facts.

Add selection actions (AI edit, Task, Link) to NativeBodyFormatPopup as BodyPopupSlots via promptSlot/buttonSlot; the toolbar owns the active prompt, its width and the dismiss fan-out. Bind each AI edit to the AiEditOrigin (view and generation) captured when its prompt opens: admit it before the selected-ids query and the request, pass it to applyAiOpsNative for every chunk, and clear its highlight when that origin rebinds. Test slots on a real mounted native session, replacing only the service.

NativeBodyFormatPopup is the device-free shell (visibility, geometry, listeners); its view entry (block-md Block.tsx, drive-view MarkdownDetail.tsx) passes `desktopBodyFormatPopup` (views/body-format-popup.tsx) or `mobileBodyFormatPopup` (views/mobile/body-format-popup.tsx) through MarkdownDocument's `bodyFormatPopup`; never branch on device inside the shell (FE-70). The touch composition mounts Source's own TouchSelectionToolbar (never a fork) in a GeneralizedPopup; its actions come from createNativeBodyTouchActions over the mounted view, and slots act through their optional select(hide). Capture the AI origin on the tap, before the popup hides; re-check generation and Edit access after any await (paste); clear the MODEL selection, not only the DOM, before blurring. An empty-text range shows the popup only on touch, through the controller's allowEmptySelection predicate (Source $allowEmptySelection), fed by NativeComments.caretCommentIds with the selection being decided on; the toolbar's hasSelection is the published selection text being non-empty, never range collapse.

The Task slot (native-task-slot.tsx) is Source MarkdownPopup's Task action: "N tasks" converts several selected checklist items through convertNativeCheckboxesToTasks (Source createTaskFromCheckbox and parsing over the model's query, one replacement write); Mod+Shift+O is registerNativeCheckboxToTaskShortcut in installNativeMarkdownOverlays. Otherwise "Task" opens the composer through the shared util/snippet-task-composer.ts (also used by Source MarkdownPopup) on the model's selection-snippet, and links each created task with group-b.insert-task-mention-at-point, chaining from its group-b.task-mention-inserted point.
