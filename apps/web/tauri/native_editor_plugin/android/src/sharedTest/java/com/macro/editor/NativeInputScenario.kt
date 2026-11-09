package com.macro.editor

import android.content.Context
import android.view.ContextThemeWrapper
import android.view.inputmethod.EditorInfo
import com.macro.documentsession.*
import com.macro.editor.bridge.mapper
import org.junit.Assert.*

internal object NativeInputScenario {
    fun config() = FfiSessionConfig(
            SyncConfig(
                "native-input-fixture", "00000000-0000-0000-0000-000000000001", "fixture-user",
                TransportKind.NONE, Persistence.MEMORY, Access.EDIT, null, null,
                Timeouts(10000uL, 5000uL, 10000uL, 10000uL, 15000uL, 10000uL),
                HeartbeatPolicy(10000uL, 5000uL, 2u), BackoffPolicy(250uL, 5u, 20u),
                ConvergePolicy(3u, 2000uL), WalPolicy(25uL, 604800000uL, 5000uL), null,
                PresencePolicy(10000L, null, PresenceUser(null, PaletteColor.BLUE), PresenceKeyMode.Peer),
                false, ResetBudget(3u, 60000uL),
            ),
            listOf(7uL, 8uL, 9uL, 10uL), PeerRange.USER, ViewOs.ANDROID, false,
            FfiApplicationConfig(FfiEditorType.MARKDOWN_SYNC, "app.example.com"), emptyList(),
        )

    fun run(targetContext: Context) {
        val config = config()
        var tick = 0uL
        val host = object : NativeEditorHost {
            override fun now(): FfiNow {
                tick++
                return FfiNow(tick, 1_000_000L + tick.toLong())
            }
            override fun execute(output: FfiOutput, admit: (FfiInput) -> Unit) {
                assertTrue(output.io.all { it is FfiIoEffect.Telemetry })
            }
            override fun viewEffect(effect: FfiViewEffect) {
                if (effect is FfiViewEffect.Error) fail(effect.message)
            }
            override fun failed(error: Exception) { throw AssertionError(error) }
        }
        val session = NativeEditorSession(config, null, host.now())
        try {
            val context = ContextThemeWrapper(targetContext,
                androidx.appcompat.R.style.Theme_AppCompat)
            val admissions = mutableListOf<String>()
            val observed = object : NativeEditorSessionInterface by session {
                override fun handle(now: FfiNow, input: FfiInput): FfiOutput = session.handle(now, input).also { output ->
                    admissions += "$input -> ${session.textContent()} ${output.view}"
                }
            }
            val view = NativeEditorView(context, observed, host, initiallyEditable = true, initiallyInteractable = true)
            view.admit(FfiInput.Start)
            view.admit(FfiInput.Seed(SeedKind.OPTIMISTIC, byteArrayOf()))
            view.admit(FfiInput.SetState(listOf(
                FfiValueEntry("type", FfiValue.Text("root")),
                FfiValueEntry("children", FfiValue.Array(listOf(FfiValue.Map(listOf(
                    FfiValueEntry("type", FfiValue.Text("paragraph")),
                    FfiValueEntry("children", FfiValue.Array(emptyList())),
                ))))),
            )))
            val patch = session.query(FfiQuery.ViewDiff) as FfiQueryReply.ViewDiff
            val paragraph = patch.diff.ops.filterIsInstance<DiffOp.CreateElement>()
                .first { op -> op.key.index != 0u }.key
            val selection = ViewSelection.Range(Point.Element(paragraph, 0u),
                Point.Element(paragraph, 0u), false)
            view.admit(FfiInput.SelectionFromView(selection, null))
            val obsoleteInput = requireNotNull(view.onCreateInputConnection(EditorInfo()))
            val input = requireNotNull(view.onCreateInputConnection(EditorInfo()))
            if (android.os.Build.VERSION.SDK_INT >= 33) {
                assertTrue(input.setComposingText("a", 1, android.view.inputmethod.TextAttribute.Builder().build()))
            } else {
                assertTrue(input.setComposingText("a", 1))
            }
            if (android.os.Build.VERSION.SDK_INT >= 33) {
                assertTrue(input.setComposingText("a😀", 1, android.view.inputmethod.TextAttribute.Builder().build()))
            } else {
                assertTrue(input.setComposingText("a😀", 1))
            }
            obsoleteInput.closeConnection()
            assertTrue(android.view.inputmethod.BaseInputConnection.getComposingSpanStart(requireNotNull(view.text)) >= 0)
            assertTrue(input.finishComposingText())
            assertEquals(admissions.joinToString("\n"), "a😀", session.textContent())
            assertEquals("a😀", view.text.toString())
            view.admit(FfiInput.Undo)
            assertEquals("", session.textContent())
            view.admit(FfiInput.Redo)
            assertEquals(admissions.joinToString("\n"), "a😀", session.textContent())
            view.setSelection(1, 3)
            val selected = session.query(FfiQuery.SelectedMarkdown(FfiMarkdownFlavor.UPSTREAM))
                as FfiQueryReply.Text
            assertEquals("😀", selected.text)
            assertTrue(input.commitText("Z", 1))
            assertEquals("aZ", session.textContent())
            assertEquals("aZ", view.text.toString())
            assertTrue(input.deleteSurroundingTextInCodePoints(1, 0))
            assertEquals("a", session.textContent())
            assertEquals("a", view.text.toString())
            view.setSelection(0, 1)
            assertTrue(input.commitText("#", 1))
            assertTrue(input.commitText(" ", 1))
            assertTrue(input.commitText("a", 1))
            assertEquals("# a", session.markdown(FfiMarkdownFlavor.APPLICATION))
            assertEquals("a", view.text.toString())
            assertTrue(requireNotNull(view.text).getSpans(0, view.length(),
                android.text.style.RelativeSizeSpan::class.java).any { it.sizeChange == 2f })
            view.setSelection(0, 1)
            assertTrue(view.onTextContextMenuItem(android.R.id.copy))
            val clipboard = context.getSystemService(android.content.ClipboardManager::class.java)
            assertEquals("a", requireNotNull(clipboard.primaryClip).getItemAt(0).text.toString())
            assertNotNull(requireNotNull(clipboard.primaryClip).getItemAt(0).htmlText)
            clipboard.setPrimaryClip(android.content.ClipData.newPlainText("", "next"))
            assertTrue(view.onTextContextMenuItem(android.R.id.paste))
            assertEquals("next", session.textContent())
            assertEquals("next", view.text.toString())
            view.setSelection(0, view.length())
            assertTrue(input.commitText("a😀", 1))
            assertTrue(input.deleteSurroundingText(1, 0))
            assertEquals("a", session.textContent())
            assertEquals("a", view.text.toString())
            view.admit(FfiInput.Command(FfiCommand.ClearEditor, ViewSelection.KeepModel))
            assertTrue(input.commitText("a", 1))
            assertTrue(view.onKeyShortcut(android.view.KeyEvent.KEYCODE_B,
                android.view.KeyEvent(0, 0, android.view.KeyEvent.ACTION_DOWN,
                    android.view.KeyEvent.KEYCODE_B, 0, android.view.KeyEvent.META_CTRL_ON)))
            assertTrue(input.commitText("b", 1))
            assertEquals("a**b**", session.markdown(FfiMarkdownFlavor.APPLICATION))
            assertTrue(requireNotNull(view.text).getSpans(1, 2,
                android.text.style.StyleSpan::class.java).any {
                    it.style == android.graphics.Typeface.BOLD &&
                        view.text?.getSpanStart(it) == 1 && view.text?.getSpanEnd(it) == 2
                })
            view.setContentInteractable(false)
            assertNull(view.onCreateInputConnection(EditorInfo()))
            assertFalse(input.commitText("locked", 1))
            assertFalse(view.onTextContextMenuItem(android.R.id.paste))
            assertEquals("ab", session.textContent())
            view.setContentInteractable(true)
            assertFalse(input.commitText("stale-after-unlock", 1))
            assertFalse(input.setSelection(0, 1))
            assertFalse(input.sendKeyEvent(android.view.KeyEvent(
                android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_DEL)))
            assertFalse(input.performContextMenuAction(android.R.id.cut))
            assertEquals(2, view.selectionStart)
            assertEquals(2, view.selectionEnd)
            assertEquals("ab", session.textContent())
            assertNotNull(view.onCreateInputConnection(EditorInfo()))
            view.setEditable(false)
            assertNull(view.onCreateInputConnection(EditorInfo()))
            assertFalse(input.commitText("blocked", 1))
            assertEquals("ab", session.textContent())
            val replacement = NativeEditorView(context, observed, host, initiallyEditable = true, initiallyInteractable = true)
            replacement.attachRunningSession()
            assertEquals("ab", replacement.text.toString())
            assertEquals(2, replacement.selectionStart)
            val reattached = requireNotNull(replacement.onCreateInputConnection(EditorInfo()))
            assertTrue(reattached.commitText("c", 1))
            assertEquals("a**bc**", session.markdown(FfiMarkdownFlavor.APPLICATION))
            replacement.admit(FfiInput.Undo)
            assertEquals("", session.textContent())
            replacement.admit(FfiInput.Redo)
            assertEquals("a**bc**", session.markdown(FfiMarkdownFlavor.APPLICATION))
            replacement.admit(FfiInput.SetState(BridgeJson.root(
                """{"root":{"type":"root","children":[{"type":"heading","tag":"h1","children":[{"type":"text","text":"beforeafter"}]}]}}""")))
            replacement.setSelection(6)
            val headingInput = requireNotNull(replacement.onCreateInputConnection(EditorInfo()))
            assertTrue(headingInput.commitText("\n", 1))
            val splitState = session.query(FfiQuery.State) as FfiQueryReply.State
            val splitBlocks = mapper.readTree(BridgeJson.state(splitState.root)).get("root").get("children")
            assertEquals(2, splitBlocks.size())
            assertEquals("heading", splitBlocks[0].get("type").textValue())
            assertEquals("paragraph", splitBlocks[1].get("type").textValue())
            assertEquals("before", splitBlocks[0].get("children")[0].get("text").textValue())
            assertEquals("after", splitBlocks[1].get("children")[0].get("text").textValue())
            assertEquals("before\nafter", replacement.text.toString())
            replacement.admit(FfiInput.SetState(BridgeJson.root(
                """{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"ab"}]}]}}""")))
            replacement.setSelection(1)
            assertTrue(replacement.onKeyDown(android.view.KeyEvent.KEYCODE_ENTER,
                android.view.KeyEvent(0, 0, android.view.KeyEvent.ACTION_DOWN,
                    android.view.KeyEvent.KEYCODE_ENTER, 0, android.view.KeyEvent.META_SHIFT_ON)))
            val shifted = session.query(FfiQuery.State) as FfiQueryReply.State
            val shiftedBlocks = mapper.readTree(BridgeJson.state(shifted.root)).get("root").get("children")
            assertEquals(1, shiftedBlocks.size())
            assertEquals("linebreak", shiftedBlocks[0].get("children")[1].get("type").textValue())
            assertEquals("a\nb", replacement.text.toString())
        } finally {
            session.close()
        }
    }

    /** View-port contract: consumed Enter may emit no diff or encounter a host failure. */
    fun consumedEnter(targetContext: Context) {
        var tick = 0uL
        var failEffects = false
        var failures = 0
        var keys = 0
        var prevent = true
        val host = object : NativeEditorHost {
            override fun now() = FfiNow(++tick, 1_000_000L + tick.toLong())
            override fun execute(output: FfiOutput, admit: (FfiInput) -> Unit) {
                assertTrue(output.io.all { it is FfiIoEffect.Telemetry })
                if (failEffects) { failEffects = false; throw IllegalStateException("fixture effect failure") }
            }
            override fun viewEffect(effect: FfiViewEffect) {
                if (effect is FfiViewEffect.Error) fail(effect.message)
            }
            override fun failed(error: Exception) {
                if (error.message == "fixture effect failure") failures++ else throw AssertionError(error)
            }
        }
        val session = NativeEditorSession(config(), null, host.now())
        try {
            val policy = object : NativeEditorSessionInterface by session {
                override fun handle(now: FfiNow, input: FfiInput): FfiOutput {
                    if (input is FfiInput.KeyDown) {
                        keys++
                        val output = session.handle(now, input.copy(routed = null))
                        return if (prevent) output.copy(view = output.view + FfiViewEffect.PreventDefault) else output
                    }
                    return session.handle(now, input)
                }
            }
            val context = ContextThemeWrapper(targetContext, androidx.appcompat.R.style.Theme_AppCompat)
            val view = NativeEditorView(context, policy, host, true, true)
            view.admit(FfiInput.Start)
            view.admit(FfiInput.Seed(SeedKind.OPTIMISTIC, byteArrayOf()))
            view.admit(FfiInput.SetState(BridgeJson.root(
                """{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"plain"}]}]}}""")))
            view.setSelection(2)
            val input = requireNotNull(view.onCreateInputConnection(EditorInfo()))
            assertTrue(input.commitText("\n", 1))
            assertEquals("plain", session.textContent())
            assertEquals("plain", view.text.toString())
            assertEquals(2, view.selectionStart)
            if (android.os.Build.VERSION.SDK_INT >= 33) {
                assertTrue(input.commitText("\n", 1, android.view.inputmethod.TextAttribute.Builder().build()))
                assertEquals("plain", view.text.toString())
                assertEquals(2, view.selectionStart)
            }
            view.text?.insert(2, "\n")
            assertEquals("plain", session.textContent())
            assertEquals("plain", view.text.toString())
            val previousKeys = keys
            failEffects = true
            assertTrue(input.commitText("\n", 1))
            assertEquals(previousKeys + 1, keys)
            assertEquals(1, failures)
            assertEquals("plain", view.text.toString())
            prevent = false
            val beforeDecline = keys
            assertTrue(input.commitText("\n", 1))
            assertEquals(beforeDecline + 1, keys)
            if (android.os.Build.VERSION.SDK_INT >= 33) {
                val beforeAttributedDecline = keys
                assertTrue(input.commitText("\n", 1, android.view.inputmethod.TextAttribute.Builder().build()))
                assertEquals(beforeAttributedDecline + 1, keys)
            }
        } finally { session.close() }
    }

}
