package com.macro.editor

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.view.ContextThemeWrapper
import com.macro.documentsession.*
import com.macro.editor.bridge.mapper
import org.junit.Assert.*

/** Actual Android clipboard admission through the full application Rust preset. */
internal object NativeClipboardPolicyScenario {
    fun run(targetContext: Context) {
        val context = ContextThemeWrapper(targetContext, androidx.appcompat.R.style.Theme_AppCompat)
        var tick = 0uL
        val host = object : NativeEditorHost {
            override fun now() = FfiNow(++tick, 1_000_000L + tick.toLong())
            override fun execute(output: FfiOutput, admit: (FfiInput) -> Unit) {
                assertTrue(output.io.all { it is FfiIoEffect.Telemetry })
            }
            override fun viewEffect(effect: FfiViewEffect) {
                if (effect is FfiViewEffect.Error) fail(effect.message)
            }
            override fun failed(error: Exception) { throw AssertionError(error) }
        }
        val clipboard = context.getSystemService(ClipboardManager::class.java)
        for (input in listOf("**literal**\n- syntax", "https://github.com/example/repository/pull/12", "x".repeat(1501))) {
            val session = NativeEditorSession(NativeInputScenario.config(), null, host.now())
            try {
                val view = NativeEditorView(context, session, host, true, true)
                view.admit(FfiInput.Start)
                view.admit(FfiInput.Seed(SeedKind.OPTIMISTIC, byteArrayOf()))
                view.admit(FfiInput.SetState(BridgeJson.root("""{"root":{"type":"root","children":[{"type":"custom-code","children":[{"type":"text","text":"prefix "}]},{"type":"paragraph","children":[]}]}}""")))
                view.setSelection(7)
                clipboard.setPrimaryClip(ClipData.newPlainText("", input))
                assertTrue(view.onTextContextMenuItem(android.R.id.paste))
                assertEquals("prefix " + input + "\n\n", session.textContent())
                assertEquals("prefix " + input + "\n", view.text.toString())
                val state = mapper.readTree(BridgeJson.state((session.query(FfiQuery.State) as FfiQueryReply.State).root))
                assertEquals(2, state.get("root").get("children").size())
                assertEquals("paragraph", state.get("root").get("children").get(1).get("type").textValue())
                assertEquals(0, state.get("root").get("children").get(1).get("children").size())
                assertTrue(state.get("root").get("children").get(0).findValues("type").none { it.textValue() in listOf("link", "paste", "document-mention", "pr-mention") })
                assertEquals("custom-code", state.get("root").get("children").get(0).get("type").textValue())
                assertEquals(7 + input.length, view.selectionStart)
                assertEquals(view.selectionStart, view.selectionEnd)
            } finally { session.destroy() }
        }
        val session = NativeEditorSession(NativeInputScenario.config(), null, host.now())
        try {
            val view = NativeEditorView(context, session, host, true, true)
            view.admit(FfiInput.Start)
            view.admit(FfiInput.Seed(SeedKind.OPTIMISTIC, byteArrayOf()))
            view.admit(FfiInput.SetState(BridgeJson.root("""{"root":{"type":"root","children":[{"type":"paragraph","children":[]}]}}""")))
            view.setSelection(0)
            clipboard.setPrimaryClip(ClipData.newPlainText("", "x".repeat(1501)))
            assertTrue(view.onTextContextMenuItem(android.R.id.paste))
            val state = mapper.readTree(BridgeJson.state((session.query(FfiQuery.State) as FfiQueryReply.State).root))
            val children = state.get("root").get("children")
            assertEquals(2, children.size())
            assertEquals("paste", children.get(0).get("type").textValue())
            assertEquals("x".repeat(1501), children.get(0).get("content").textValue())
            assertEquals("pasted", children.get(0).get("origin").textValue())
            assertEquals("paragraph", children.get(1).get("type").textValue())
            assertEquals(0, children.get(1).get("children").size())
            val selection = (session.query(FfiQuery.ViewDiff) as FfiQueryReply.ViewDiff).selection as ViewSelection.Range
            assertTrue(selection.anchor is Point.Element)
            assertEquals(0u, (selection.anchor as Point.Element).offset)
            assertEquals(selection.anchor, selection.focus)
            val selected = (session.query(FfiQuery.Node((selection.anchor as Point.Element).key)) as FfiQueryReply.Nodes).nodes.single()
            assertEquals("paragraph", mapper.readTree(BridgeJson.stringify(FfiValue.Map(selected))).get("type").textValue())
            assertEquals(view.length(), view.selectionStart)
            assertEquals(view.selectionStart, view.selectionEnd)
        } finally { session.destroy() }
    }
}
