package com.macro.editor

import android.content.Context
import android.view.ContextThemeWrapper
import android.view.KeyEvent
import android.view.inputmethod.EditorInfo
import com.macro.documentsession.*
import com.macro.editor.bridge.*
import org.junit.Assert.*

internal object NativeMenuScenario {
    fun run(targetContext: Context, attach: (NativeEditorView) -> Unit = {},
        afterRows: (NativeEditorView, MenuRowsRequest, List<MenuEvent>) -> Unit = { _, _, _ -> }) {
        var tick = 0uL
        val host = object : NativeEditorHost {
            override fun now() = FfiNow(++tick, 1_000_000L + tick.toLong())
            override fun execute(output: FfiOutput, admit: (FfiInput) -> Unit) = Unit
            override fun viewEffect(effect: FfiViewEffect) { if (effect is FfiViewEffect.Error) fail(effect.message) }
            override fun failed(error: Exception) { throw AssertionError(error) }
        }
        val session = NativeEditorSession(NativeInputScenario.config(), null, host.now())
        try {
            val view = NativeEditorView(ContextThemeWrapper(targetContext, androidx.appcompat.R.style.Theme_AppCompat),
                session, host, true, true)
            val events = mutableListOf<MenuEvent>()
            view.connectMenu(1, events::add)
            attach(view)
            view.admit(FfiInput.Start)
            view.admit(FfiInput.Seed(SeedKind.OPTIMISTIC, byteArrayOf()))
            view.admit(FfiInput.SetState(BridgeJson.root("""{"root":{"type":"root","children":[{"type":"paragraph","children":[]}]}}""")))
            view.setSelection(0)
            val input = requireNotNull(view.onCreateInputConnection(EditorInfo()))
            assertTrue(input.commitText("@", 1))
            val query = events.last { it.action == Action.Query }.query
            assertEquals(QueryKind.Mention, query.kind)
            assertEquals("", query.term)
            val rows = MenuRowsRequest(listOf(MenuBucket(hasMore = true, id = "users", isLoading = false,
                isLoadingMore = false, label = "People", loadedCount = 2)), query.identity,
                listOf(MenuRow("users", id = "first", label = "First"), MenuRow("users", id = "second", label = "Second")),
                SurfaceScope(1, 1, "fixture"))
            view.menuRows(rows)
            afterRows(view, rows, events)
            view.menuRows(rows)
            assertEquals(1, events.count { it.action == Action.More })
            assertTrue(view.onKeyDown(KeyEvent.KEYCODE_TAB, KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_TAB)))
            assertTrue(view.onKeyDown(KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_DOWN)))
            assertTrue(view.onKeyDown(KeyEvent.KEYCODE_ENTER, KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER)))
            val selected = events.last { it.action == Action.Select }
            assertEquals("first", selected.rowID)
            assertEquals("@", session.textContent())
            val commit = MenuCommitRequest(MenuChoice(kind = ChoiceKind.User,
                user = MenuUser(displayName = "First", email = "user@example.com", userID = "fixture-user")),
                query.identity, "first", rows.scope)
            assertNull(view.menuChoice(commit.copy(identity = query.identity.copy(queryGeneration = 99))))
            val payload = requireNotNull(view.menuChoice(commit))
            view.acceptOutput(session.applicationCommand(host.now(), "group-a.menu-select", BridgeJson.parse(payload),
                query.identity.modelGeneration.toUInt(), ViewSelection.KeepModel))
            assertEquals("@First", session.textContent())
            assertNull(view.menuChoice(commit))

            // Escape and empty-result Enter preserve the literal query and do not insert a paragraph.
            view.admit(FfiInput.SetState(BridgeJson.root("""{"root":{"type":"root","children":[{"type":"paragraph","children":[]}]}}""")))
            view.setSelection(0)
            val fresh = requireNotNull(view.onCreateInputConnection(EditorInfo()))
            assertTrue(fresh.commitText("/", 1))
            assertTrue(view.onKeyDown(KeyEvent.KEYCODE_ESCAPE, KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ESCAPE)))
            assertEquals("/", session.textContent())
            assertTrue(fresh.commitText(" ;", 1))
            // Only a single inserted trigger opens a menu; a pasted multi-character string does not.
            val count = events.count { it.action == Action.Query }
            assertTrue(fresh.commitText(" ", 1))
            assertTrue(fresh.commitText(";", 1))
            assertEquals("/ ; ;", session.textContent())
            assertEquals("menu events=$events native=${view.text} caret=${view.selectionStart}", count + 1, events.count { it.action == Action.Query })
            assertTrue(view.onKeyDown(KeyEvent.KEYCODE_ENTER, KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER)))
            assertEquals("/ ; ;", session.textContent())
        } finally { session.destroy() }
    }
}
