package com.macro.editor

import android.content.Context
import android.view.ContextThemeWrapper
import com.macro.documentsession.*
import com.macro.editor.bridge.mapper
import org.junit.Assert.*

/** Matched JNI resolves a real pending node; the caller still owns fetch and every effect. */
internal object NativeSnippetScenario {
    fun run(targetContext: Context) {
        var tick = 0uL
        var request: com.fasterxml.jackson.databind.JsonNode? = null
        val host = object : NativeEditorHost {
            override fun now() = FfiNow(++tick, 1_000_000L + tick.toLong())
            override fun execute(output: FfiOutput, admit: (FfiInput) -> Unit) {
                assertTrue(output.io.all { it is FfiIoEffect.Telemetry })
            }
            override fun viewEffect(effect: FfiViewEffect) {
                if (effect is FfiViewEffect.Error) fail(effect.message)
                if (effect is FfiViewEffect.PluginEvent && effect.name == "group-a.snippet-request")
                    request = mapper.readTree(BridgeJson.stringify(requireNotNull(effect.payload)))
            }
            override fun failed(error: Exception) { throw AssertionError(error) }
        }
        val session = NativeEditorSession(NativeInputScenario.config(), null, host.now())
        try {
            val view = NativeEditorView(ContextThemeWrapper(targetContext, androidx.appcompat.R.style.Theme_AppCompat), session, host, true, true)
            view.admit(FfiInput.Start)
            view.admit(FfiInput.Seed(SeedKind.OPTIMISTIC, byteArrayOf()))
            view.admit(FfiInput.SetState(BridgeJson.root("""{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"😀 "}]}]}}""")))
            view.setSelection(3)
            assertTrue(requireNotNull(view.onCreateInputConnection(android.view.inputmethod.EditorInfo())).commitText(";s", 1))
            view.admit(FfiInput.Command(FfiCommand.ClearHistory, ViewSelection.KeepModel))
            val text = (session.query(FfiQuery.NodesOfType("text")) as FfiQueryReply.Nodes).keys.single()
            val started = session.applicationCommand(host.now(), "group-a.menu-select", BridgeJson.parse("""{"key":${text.index},"offset":3,"expected":";s","choice":{"kind":"snippet-start","payload":{"documentId":"snippet-fixture","sourceDocumentId":"target-fixture"}}}"""), text.generation, ViewSelection.KeepModel)
            view.acceptOutput(started)
            host.execute(started, view::admit)
            val token = requireNotNull(request)
            val placeholder = (session.query(FfiQuery.NodesOfType("await")) as FfiQueryReply.Nodes).keys.single()
            assertEquals(placeholder.index.toLong(), token.get("key").longValue())
            assertEquals(placeholder.generation.toLong(), token.get("generation").longValue())
            assertEquals("snippet-fixture", token.get("documentId").textValue())
            val awaitID = token.get("awaitId").textValue()
            assertEquals(21, awaitID.length)
            val result = session.resolveSnippet(host.now(), placeholder, awaitID, BridgeJson.parse("""{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"bold","format":1,"$":{"id":"source-text"}}]}]}}"""))
            view.acceptOutput(result)
            host.execute(result, view::admit)
            assertEquals("😀 bold", view.text.toString())
            assertEquals("😀 **bold**", session.markdown(FfiMarkdownFlavor.APPLICATION))
            assertEquals(7, view.selectionStart)
            assertEquals(7, view.selectionEnd)
            val expected = BridgeJson.state((session.query(FfiQuery.State) as FfiQueryReply.State).root)
            assertFalse(expected.contains("source-text"))
            assertTrue((session.query(FfiQuery.NodesOfType("await")) as FfiQueryReply.Nodes).keys.isEmpty())
            view.admit(FfiInput.Undo)
            assertEquals("😀 ;s", view.text.toString())
            view.admit(FfiInput.Redo)
            assertEquals(expected, BridgeJson.state((session.query(FfiQuery.State) as FfiQueryReply.State).root))
            assertEquals("😀 bold", view.text.toString())
            assertEquals(7, view.selectionStart)
            assertEquals(7, view.selectionEnd)
            val late = session.resolveSnippet(host.now(), placeholder, awaitID, null)
            view.acceptOutput(late)
            host.execute(late, view::admit)
            assertEquals(expected, BridgeJson.state((session.query(FfiQuery.State) as FfiQueryReply.State).root))
        } finally { session.destroy() }
    }
    fun sourceCache(targetContext: Context) {
        var tick = 0uL
        var request: com.fasterxml.jackson.databind.JsonNode? = null
        val errors = mutableListOf<String>()
        val host = object : NativeEditorHost {
            override fun now() = FfiNow(++tick, 1_000_000L + tick.toLong())
            override fun execute(output: FfiOutput, admit: (FfiInput) -> Unit) {
                assertTrue(output.io.all { it is FfiIoEffect.Telemetry })
            }
            override fun viewEffect(effect: FfiViewEffect) {
                if (effect is FfiViewEffect.Error) fail(effect.message)
                if (effect is FfiViewEffect.PluginEvent) {
                    if (effect.name == "group-a.snippet-request") request = mapper.readTree(BridgeJson.stringify(requireNotNull(effect.payload)))
                    if (effect.name == "group-a.snippet-source-error") errors += mapper.readTree(BridgeJson.stringify(requireNotNull(effect.payload))).get("message").textValue()
                }
            }
            override fun failed(error: Exception) { throw AssertionError(error) }
        }
        val session = NativeEditorSession(NativeInputScenario.config(), null, host.now())
        try {
            val view = NativeEditorView(ContextThemeWrapper(targetContext, androidx.appcompat.R.style.Theme_AppCompat), session, host, true, true)
            view.admit(FfiInput.Start)
            view.admit(FfiInput.Seed(SeedKind.OPTIMISTIC, byteArrayOf()))
            val tokens = mutableSetOf<String>()
            val sources = listOf(
                """{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"First snippet","format":1}]}]}}""",
                """{"root":{"type":"root","children":[]}}""",
                """{"root":{"type":"root","children":[{"type":"fixture-unknown-snippet-node","version":1}]}}""",
                """{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"Second snippet","format":1}]}]}}""",
            )
            for ((index, raw) in sources.withIndex()) {
                view.admit(FfiInput.SetState(BridgeJson.root("""{"root":{"type":"root","children":[{"type":"paragraph","children":[]}]}}""")))
                view.setSelection(0)
                assertTrue(requireNotNull(view.onCreateInputConnection(android.view.inputmethod.EditorInfo())).commitText(";", 1))
                val text = (session.query(FfiQuery.NodesOfType("text")) as FfiQueryReply.Nodes).keys.single()
                request = null
                val started = session.applicationCommand(host.now(), "group-a.menu-select", BridgeJson.parse("""{"key":${text.index},"offset":0,"expected":";","choice":{"kind":"snippet-start","payload":{"documentId":"snippet-$index"}}}"""), text.generation, ViewSelection.KeepModel)
                view.acceptOutput(started)
                host.execute(started, view::admit)
                val token = requireNotNull(request)
                val placeholder = (session.query(FfiQuery.NodesOfType("await")) as FfiQueryReply.Nodes).keys.single()
                val awaitID = token.get("awaitId").textValue()
                assertTrue(tokens.add(awaitID))
                val resolved = session.resolveSnippet(host.now(), placeholder, awaitID, BridgeJson.parse(raw))
                view.acceptOutput(resolved)
                host.execute(resolved, view::admit)
                val expected = if (index < 3) "First snippet" else "Second snippet"
                assertEquals(expected, view.text.toString())
                assertEquals("**$expected**", session.markdown(FfiMarkdownFlavor.APPLICATION))
                assertEquals(expected.length, view.selectionStart)
                assertEquals(view.selectionStart, view.selectionEnd)
                val state = mapper.readTree(BridgeJson.state((session.query(FfiQuery.State) as FfiQueryReply.State).root))
                assertEquals(expected, state.get("root").get("children").get(0).get("children").get(0).get("text").textValue())
                assertEquals(1, state.get("root").get("children").get(0).get("children").get(0).get("format").intValue())
                assertTrue((session.query(FfiQuery.NodesOfType("await")) as FfiQueryReply.Nodes).keys.isEmpty())
            }
            assertEquals(1, errors.size)
            assertTrue(errors.single().contains("fixture-unknown-snippet-node"))
        } finally { session.destroy() }
    }

}
