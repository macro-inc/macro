package com.macro.editor

import android.content.Context
import android.view.ContextThemeWrapper
import android.view.KeyEvent
import android.view.inputmethod.EditorInfo
import com.macro.documentsession.*
import com.macro.editor.bridge.mapper
import org.junit.Assert.*

internal object NativeHistoryScenario {
    fun restoredCodeIdentity(targetContext: Context, application: Boolean) {
        var tick = 0uL
        val host = object : NativeEditorHost {
            override fun now() = FfiNow(++tick, 1_000_000L + tick.toLong())
            override fun execute(output: FfiOutput, admit: (FfiInput) -> Unit) { assertTrue(output.io.all { it is FfiIoEffect.Telemetry }) }
            override fun viewEffect(effect: FfiViewEffect) { if (effect is FfiViewEffect.Error) fail(effect.message) }
            override fun failed(error: Exception) { throw AssertionError(error) }
        }
        val config = NativeInputScenario.config().let { if (application) it else it.copy(application = null) }
        val session = NativeEditorSession(config, null, host.now())
        try {
            val keys = mutableListOf<FfiInput.KeyDown>()
            val observed = object : NativeEditorSessionInterface by session {
                override fun handle(now: FfiNow, input: FfiInput): FfiOutput {
                    if (input is FfiInput.KeyDown) keys += input
                    return session.handle(now, input)
                }
            }
            val view = NativeEditorView(ContextThemeWrapper(targetContext, androidx.appcompat.R.style.Theme_AppCompat),
                observed, host, true, true)
            view.admit(FfiInput.Start)
            view.admit(FfiInput.Seed(SeedKind.OPTIMISTIC, byteArrayOf()))
            view.admit(FfiInput.SetState(BridgeJson.root("""{"root":{"type":"root","children":[{"type":"paragraph","children":[]}]}}""")))
            view.setSelection(0)
            view.admit(FfiInput.Command(FfiCommand.ClearHistory, ViewSelection.KeepModel))
            val code = if (application) "custom-code" else "code"
            view.admit(FfiInput.SetState(BridgeJson.root("""{"root":{"type":"root","children":[{"type":"$code","children":[{"type":"text","text":"const localValue = 1;"}]},{"type":"paragraph","children":[]}]}}""")))
            view.setSelection(21)
            assertTrue(requireNotNull(view.onCreateInputConnection(EditorInfo())).commitText("x", 1))
            val typed = BridgeJson.state((session.query(FfiQuery.State) as FfiQueryReply.State).root)
            assertEquals("const localValue = 1;x\n", view.text.toString())
            assertEquals(22, view.selectionStart)
            val typedRoot = mapper.readTree(typed).get("root")
            val id = typedRoot.get("children").get(0).get("children").get(0).get("$").get("id").textValue()
            assertTrue(id.isNotEmpty())
            repeat(2) {
                assertTrue(view.onKeyShortcut(KeyEvent.KEYCODE_Z, KeyEvent(0, 0, KeyEvent.ACTION_DOWN,
                    KeyEvent.KEYCODE_Z, 0, KeyEvent.META_CTRL_ON)))
                val undone = mapper.readTree(BridgeJson.state((session.query(FfiQuery.State) as FfiQueryReply.State).root)).get("root")
                assertEquals(1, undone.get("children").size())
                assertEquals("paragraph", undone.get("children").get(0).get("type").textValue())
                assertEquals("", view.text.toString())
                assertTrue(view.onKeyShortcut(KeyEvent.KEYCODE_Z, KeyEvent(0, 0, KeyEvent.ACTION_DOWN,
                    KeyEvent.KEYCODE_Z, 0, KeyEvent.META_CTRL_ON or KeyEvent.META_SHIFT_ON)))
                val actual = BridgeJson.state((session.query(FfiQuery.State) as FfiQueryReply.State).root)
                assertEquals(typed, actual)
                assertEquals("const localValue = 1;x\n", view.text.toString())
                assertEquals(22, view.selectionStart)
                assertEquals(22, view.selectionEnd)
                val selection = (session.query(FfiQuery.ViewDiff) as FfiQueryReply.ViewDiff).selection as ViewSelection.Range
                assertTrue(selection.anchor is Point.Text)
                assertEquals(22u, (selection.anchor as Point.Text).offset)
                assertEquals(selection.anchor, selection.focus)
                val selected = (session.query(FfiQuery.Node((selection.anchor as Point.Text).key)) as FfiQueryReply.Nodes).nodes.single()
                assertEquals(id, mapper.readTree(BridgeJson.stringify(FfiValue.Map(selected))).get("$").get("id").textValue())
            }
            assertEquals(4, keys.size)
            assertEquals(listOf(FfiCommand.Undo, FfiCommand.Redo, FfiCommand.Undo, FfiCommand.Redo), keys.map { it.routed })
        } finally { session.destroy() }
    }
}
