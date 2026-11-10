package com.macro.editor

import android.content.ClipboardManager
import android.content.Context
import android.view.ContextThemeWrapper
import com.macro.documentsession.*
import com.macro.editor.bridge.mapper
import org.junit.Assert.*

/** Real Rust import/export across two independent native views and Android clipboard. */
internal object NativeClipboardScenario {
    fun run(targetContext: Context) {
        val context = ContextThemeWrapper(targetContext, androidx.appcompat.R.style.Theme_AppCompat)
        var mono = 0uL
        val host = object : NativeEditorHost {
            override fun now() = FfiNow(++mono, 1_000_000L + mono.toLong())
            override fun execute(output: FfiOutput, admit: (FfiInput) -> Unit) {
                assertTrue(output.io.all { it is FfiIoEffect.Telemetry })
            }
            override fun viewEffect(effect: FfiViewEffect) {
                if (effect is FfiViewEffect.Error) fail(effect.message)
            }
            override fun failed(error: Exception) { throw AssertionError(error) }
        }
        val first = NativeEditorSession(NativeInputScenario.config(), null, host.now())
        val second = NativeEditorSession(NativeInputScenario.config().copy(peers = listOf(17uL, 18uL, 19uL, 20uL)), null, host.now())
        try {
            val source = NativeEditorView(context, first, host, true, true)
            val destination = NativeEditorView(context, second, host, true, true)
            for ((view, session) in listOf(source to first, destination to second)) {
                view.admit(FfiInput.Start)
                view.admit(FfiInput.Seed(SeedKind.OPTIMISTIC, byteArrayOf()))
                val json = if (view === source) {
                    """{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"bold😀","format":1}]}]}}"""
                } else {
                    """{"root":{"type":"root","children":[{"type":"paragraph","children":[]}]}}"""
                }
                view.admit(FfiInput.SetState(BridgeJson.root(json)))
                val patch = session.query(FfiQuery.ViewDiff) as FfiQueryReply.ViewDiff
                val paragraph = patch.diff.ops.filterIsInstance<DiffOp.CreateElement>().first { it.key.index != 0u }.key
                view.admit(FfiInput.SelectionFromView(ViewSelection.Range(Point.Element(paragraph, 0u), Point.Element(paragraph, 0u), false), null))
            }
            source.setSelection(0, source.length())
            assertTrue(source.onTextContextMenuItem(android.R.id.copy))
            val clip = requireNotNull(context.getSystemService(ClipboardManager::class.java).primaryClip)
            assertEquals("bold😀", clip.getItemAt(0).text.toString())
            val internal = requireNotNull(EditorClipboard(context).read()).data
                .single { it.mime == "application/x-lexical-editor" }.text
            assertEquals("block-md-main", mapper.readTree(internal).get("namespace").textValue())
            // No HTML fallback: a portable session must reject the foreign rich namespace.
            val portable = NativeEditorSession(NativeInputScenario.config().copy(application = null), null, host.now())
            try {
                val view = NativeEditorView(context, portable, host, true, true)
                view.admit(FfiInput.Start)
                view.admit(FfiInput.Seed(SeedKind.OPTIMISTIC, byteArrayOf()))
                view.admit(FfiInput.SetState(BridgeJson.root("""{"root":{"type":"root","children":[{"type":"paragraph","children":[]}]}}""")))
                val diff = (portable.query(FfiQuery.ViewDiff) as FfiQueryReply.ViewDiff).diff
                val paragraph = diff.ops.filterIsInstance<DiffOp.CreateElement>().first { it.key.index != 0u }.key
                view.admit(FfiInput.SelectionFromView(ViewSelection.Range(Point.Element(paragraph, 0u), Point.Element(paragraph, 0u), false), null))
                view.admit(FfiInput.Paste(FfiClipboardPayload(listOf(
                    FfiClipboardEntry("application/x-lexical-editor", internal),
                    FfiClipboardEntry("text/plain", "fallback")), false, null, FfiPasteIntent(false)), ViewSelection.KeepModel))
                assertEquals("fallback", portable.textContent())
                view.setSelection(0, view.length())
                val exported = (portable.query(FfiQuery.Clipboard) as FfiQueryReply.Clipboard).entries
                    .single { it.mime == "application/x-lexical-editor" }.text
                val payload = mapper.readTree(exported)
                assertEquals("document-session", payload.get("namespace").textValue())
                assertEquals(0, payload.get("nodes").get(0).get("format").intValue())
            } finally { portable.close() }

            assertTrue(requireNotNull(clip.getItemAt(0).htmlText).contains("bold😀"))
            val missingPlain = android.content.ClipData(android.content.ClipDescription(clip.description),
                android.content.ClipData.Item(android.content.Intent()))
            val incompleteMetadata = android.os.PersistableBundle(requireNotNull(clip.description.extras))
            incompleteMetadata.remove("com.macro.editor.plain")
            missingPlain.description.extras = incompleteMetadata
            context.getSystemService(ClipboardManager::class.java).setPrimaryClip(missingPlain)
            assertTrue(requireNotNull(EditorClipboard(context).read()).data.none { it.mime == "application/x-lexical-editor" })
            context.getSystemService(ClipboardManager::class.java).setPrimaryClip(clip)
            assertTrue(destination.onTextContextMenuItem(android.R.id.paste))
            assertEquals("bold😀", second.textContent())
            assertEquals("**bold😀**", second.markdown(FfiMarkdownFlavor.APPLICATION))
            destination.admit(FfiInput.Undo)
            assertEquals("", second.textContent())
            destination.admit(FfiInput.Redo)
            assertEquals("**bold😀**", second.markdown(FfiMarkdownFlavor.APPLICATION))
            destination.admit(FfiInput.Command(FfiCommand.ClearEditor, ViewSelection.KeepModel))
            context.getSystemService(ClipboardManager::class.java).setPrimaryClip(
                android.content.ClipData.newPlainText("", "**literal😀**"))
            assertTrue(destination.onTextContextMenuItem(android.R.id.pasteAsPlainText))
            assertEquals("**literal😀**", second.textContent())
            destination.admit(FfiInput.Command(FfiCommand.ClearEditor, ViewSelection.KeepModel))
            assertTrue(destination.onTextContextMenuItem(android.R.id.paste))
            assertEquals("literal😀", second.textContent())
            assertEquals("**literal😀**", second.markdown(FfiMarkdownFlavor.APPLICATION))
            destination.admit(FfiInput.Command(FfiCommand.ClearEditor, ViewSelection.KeepModel))
            val changedClip = android.content.ClipData(clip.description, android.content.ClipData.Item("changed😀"))
            context.getSystemService(ClipboardManager::class.java).setPrimaryClip(changedClip)
            assertTrue(destination.onTextContextMenuItem(android.R.id.paste))
            assertEquals("changed😀", second.textContent())
            destination.setContentInteractable(false)
            assertFalse(destination.onTextContextMenuItem(android.R.id.paste))
            assertEquals("changed😀", second.markdown(FfiMarkdownFlavor.APPLICATION))
        } finally {
            first.close()
            second.close()
        }
    }
}
