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

Install the actual Source restoreFocusPlugin in app-equivalent fixtures before qualifying focus-dependent dropdown controls; direct-button controls alone do not prove More-menu restoration.

Capture all native formatting query results inside the construction-time latestPublished observer and expose only those data snapshots to reactive UI. Retire presentation without native receivers; terminal key handles stay with the actual view owner until its existing close fence. Ordinary component cleanup still unregisters its actual listeners while admission permits.

Keep native FormatTools in the selected-body withinPopup path; its full-header title/body focus routing is not qualified by this component checkpoint and must retain Source behavior before any broader host wiring.

Mount the native body floating menu through its construction-time publication observer and an independent optional overlay lifetime; reuse the document interaction accessor including generation, waiting and editor-error locks. Keep its Link button hidden until the native link editor is qualified. The slash Link row reaches the native link host through the overlay's `requestLink`, which follows Source TRY_INSERT_LINK (create at a caret, Prepare then edit on a range) and throws before the first publication.

Co-dispose HostedFloatingLinkMenu with its actual native link host inside the overlay's FloatingMenuGroup and ErrorBoundary; registerMenu has no independent unbind. Gate interaction and deferred opening on the supplied document interaction accessor. A renderer unit checkpoint does not activate the body Link button.

Use the actual document-body call chain MarkdownPopup → FormatTools withinPopup as the body toolbar oracle. HostedFloatingFormatMenu belongs to MarkdownTextarea/Shell; its component proofs do not establish body UI admission or the six-item body More menu.

Render Comment inside NativeBodyFormatPopup, never a second toolbar: show it for commenters while the live root exists and the session draft capability is mounted, after one divider only when formatting controls are present; keep formatting gated on the host interaction accessor. Keep the popup open with the Source toast on failed insertion and close it on success.

Read expanded selection text through the generation-checked group-b.selection-text query inside latestPublished and before link preparation; never request clipboard formats on publication, keep full formats demand-driven by copy/cut/dragstart, and keep the table popup driven by its own facts.

Add selection actions (AI edit, Task, Link) to NativeBodyFormatPopup as BodyPopupSlots via promptSlot/buttonSlot; the toolbar owns the active prompt, its width and the dismiss fan-out. Bind each AI edit to the AiEditOrigin (view and generation) captured when its prompt opens: admit it before the selected-ids query and the request, pass it to applyAiOpsNative for every chunk, and clear its highlight when that origin rebinds. Test slots on a real mounted native session, replacing only the service.
