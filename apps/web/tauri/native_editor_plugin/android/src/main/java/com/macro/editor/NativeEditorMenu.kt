package com.macro.editor

import android.graphics.Rect
import android.graphics.drawable.ColorDrawable
import android.view.Gravity
import android.view.KeyEvent
import android.widget.ArrayAdapter
import android.widget.ListView
import android.widget.PopupWindow
import com.macro.documentsession.*
import com.macro.editor.bridge.*

/** A popup owns no document data. Every answer is tied to the live native search span. */
internal class NativeEditorMenu(
    private val editor: NativeEditorView,
    private val mountGeneration: Long,
    private val emit: (MenuEvent) -> Unit,
) {
    private data class Target(val key: NodeKey, val offset: Int, val symbol: Char)
    private data class Frontier(val bucket: String, val query: String, val index: Int, val count: Int)
    private var target: Target? = null
    private var query: MenuQuery? = null
    private var invocation = 0L
    private var rows = emptyList<MenuRow>()
    private var buckets = emptyList<MenuBucket>()
    private var selected = 0
    private var pending: String? = null
    private var literal = ""
    private var frontier: Frontier? = null
    private var activeBucket: String? = null
    private var popup: PopupWindow? = null
    private var list: ListView? = null

    fun sync(projection: EditorProjection, layout: EditorProjection.Layout, composing: Boolean,
        editable: Boolean, trigger: Char? = null) {
        if (!editable || editor.selectionStart != editor.selectionEnd) { close(); return }
        val caret = editor.selectionStart
        val range = layout.ranges.firstOrNull { caret > it.start && caret <= it.end }
        val code = layout.elements.any { caret >= it.start && caret <= it.end &&
            projection.nodes[it.key]?.let(projection::typeName) in setOf("code", "custom-code") }
        if (range == null || code) { close(); return }
        val current = target
        if (current == null) {
            if (composing || trigger !in listOf('@', '/', ';', ':') || caret < 1 ||
                layout.text[caret - 1] != trigger) return
            val before = layout.text.getOrNull(caret - 2)
            val after = layout.text.getOrNull(caret)
            if (before != null && !before.isWhitespace()) return
            if (trigger != '@' && after != null && !after.isWhitespace()) return
            check(invocation < UInt.MAX_VALUE.toLong())
            invocation++
            target = Target(range.key, caret - range.start - 1, requireNotNull(trigger))
            val kind = when (trigger) { '@' -> QueryKind.Mention; '/' -> QueryKind.Action; ';' -> QueryKind.Snippet; else -> QueryKind.Emoji }
            query = MenuQuery(MenuIdentity(invocation, range.key.generation.toLong(), mountGeneration, 0), kind, projection.registeredTypeNames(), 0, "")
        }
        val live = requireNotNull(target)
        val start = range.start + live.offset
        if (range.key != live.key || start < range.start || caret <= start ||
            layout.text.getOrNull(start) != live.symbol) { close(); return }
        literal = layout.text.substring(start, caret)
        val term = literal.substring(1).replace("\u200b", "")
        if (term.contains('\n')) { close(); return }
        val previous = requireNotNull(query)
        if (previous.term != term || trigger != null && current == null) {
            pending = null
            selected = 0
            rows = emptyList()
            buckets = emptyList()
            frontier = null
            check(previous.identity.queryGeneration < UInt.MAX_VALUE.toLong())
            query = previous.copy(identity = previous.identity.copy(queryGeneration = previous.identity.queryGeneration + 1), term = term, selectedIndex = 0)
            hide()
            emit(MenuEvent(Action.Query, query = requireNotNull(query)))
        }
    }

    fun rows(request: MenuRowsRequest) {
        if (query?.identity != request.identity || pending != null) return
        require(request.buckets.map { it.id }.distinct().size == request.buckets.size)
        require(request.buckets.all { it.loadedCount >= 0 })
        val ids = request.buckets.map { it.id }.toSet()
        require(request.rows.all { it.id.isNotEmpty() && it.bucketID in ids })
        rows = request.rows.distinctBy { it.id }
        buckets = request.buckets
        selected = selected.coerceAtMost((rows.size - 1).coerceAtLeast(0))
        show()
        more()
    }

    fun commit(request: MenuCommitRequest): String? {
        if (query?.identity != request.identity || pending != request.rowID || !editor.acceptsInput()) return null
        val live = target ?: return null
        val expected = literal
        val payload: Any = when (request.choice.kind) {
            ChoiceKind.Text -> requireNotNull(request.choice.text)
            ChoiceKind.User -> requireNotNull(request.choice.user)
            ChoiceKind.Document -> requireNotNull(request.choice.document)
            ChoiceKind.Date -> requireNotNull(request.choice.date)
            ChoiceKind.Group -> mapOf("groupAlias" to requireNotNull(request.choice.groupAlias))
            ChoiceKind.AgentSession -> requireNotNull(request.choice.agentSession)
            ChoiceKind.BookingLink -> requireNotNull(request.choice.bookingLink)
            ChoiceKind.Block -> requireNotNull(request.choice.block).value
            ChoiceKind.Snippet -> mapper.readTree(requireNotNull(request.choice.snippetNodesJSON)).also { require(it.isArray) }
        }
        val json = mapper.writeValueAsString(mapOf("key" to live.key.index.toLong(), "offset" to live.offset,
            "expected" to expected, "choice" to mapOf("kind" to request.choice.kind.value, "payload" to payload)))
        close()
        return json
    }

    fun key(event: KeyEvent): Boolean {
        if (query == null) return false
        when (event.keyCode) {
            KeyEvent.KEYCODE_ESCAPE, KeyEvent.KEYCODE_BACK -> close()
            KeyEvent.KEYCODE_DPAD_UP -> move(-1)
            KeyEvent.KEYCODE_DPAD_DOWN -> move(1)
            KeyEvent.KEYCODE_TAB -> move(if (event.isShiftPressed) -1 else 1)
            KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT -> Unit
            KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> select()
            else -> return false
        }
        return true
    }

    private fun move(delta: Int) {
        if (rows.isEmpty() || pending != null) return
        selected = (selected + delta + rows.size) % rows.size
        list?.setItemChecked(selected, true)
        list?.setSelection(selected)
        more()
    }

    private fun select() {
        if (pending != null) return
        val row = rows.getOrNull(selected) ?: run { close(); return }
        pending = row.id
        hide()
        emit(MenuEvent(Action.Select, row.bucketID, requireNotNull(query).copy(selectedIndex = selected.toLong()), row.id))
    }

    private fun more() {
        val row = rows.getOrNull(selected) ?: run { frontier = null; activeBucket = null; return }
        if (activeBucket != row.bucketID) { activeBucket = row.bucketID; frontier = null }
        val bucket = buckets.firstOrNull { it.id == row.bucketID } ?: return
        if (!bucket.hasMore || bucket.isLoadingMore || selected < rows.size - 5) return
        val current = requireNotNull(query)
        val next = Frontier(bucket.id, current.term, selected, rows.size)
        if (frontier == next) return
        frontier = next
        emit(MenuEvent(Action.More, bucket.id, current.copy(selectedIndex = selected.toLong())))
    }

    private fun show() {
        if (editor.windowToken == null || pending != null) return
        hide()
        val content = ListView(editor.context)
        list = content
        val loading = buckets.any { it.isLoading || it.isLoadingMore }
        val labels = rows.map { row -> listOfNotNull(row.label, row.detail).joinToString("\n") }
            .ifEmpty { listOf(if (loading) "Loading…" else if (buckets.any { it.error != null }) "Search unavailable" else "No results") }
        content.adapter = object : ArrayAdapter<String>(editor.context, android.R.layout.simple_list_item_activated_1, labels) {
            override fun isEnabled(position: Int) = position < rows.size
        }
        content.choiceMode = ListView.CHOICE_MODE_SINGLE
        content.setItemChecked(selected, true)
        val shownIdentity = query?.identity
        val shownRows = rows.toList()
        content.setOnItemClickListener { _, _, position, _ ->
            if (list === content && query?.identity == shownIdentity &&
                rows.getOrNull(position)?.id == shownRows.getOrNull(position)?.id) {
                selected = position
                select()
            }
        }
        val density = editor.resources.displayMetrics.density
        val visible = Rect().also(editor::getWindowVisibleDisplayFrame)
        val location = IntArray(2).also(editor::getLocationOnScreen)
        val layout = editor.layout ?: return
        val line = layout.getLineForOffset(editor.selectionEnd.coerceAtLeast(0))
        val caretTop = location[1] + editor.totalPaddingTop + layout.getLineTop(line) - editor.scrollY
        val caretBottom = location[1] + editor.totalPaddingTop + layout.getLineBottom(line) - editor.scrollY
        val height = (labels.size * 48 * density).toInt().coerceAtMost((256 * density).toInt()).coerceAtMost(visible.height())
        val width = (320 * density).toInt().coerceAtMost(visible.width())
        val x = (location[0] + editor.totalPaddingLeft + layout.getPrimaryHorizontal(editor.selectionEnd).toInt() - editor.scrollX)
            .coerceIn(visible.left, (visible.right - width).coerceAtLeast(visible.left))
        val y = if (visible.bottom - caretBottom >= height) caretBottom else (caretTop - height).coerceAtLeast(visible.top)
        val window = PopupWindow(content, width, height, false)
        val color = android.util.TypedValue().also { editor.context.theme.resolveAttribute(android.R.attr.colorBackground, it, true) }.data
        window.setBackgroundDrawable(ColorDrawable(color))
        window.isOutsideTouchable = true
        window.inputMethodMode = PopupWindow.INPUT_METHOD_NEEDED
        window.setOnDismissListener { if (popup === window) close() }
        popup = window
        window.showAtLocation(editor, Gravity.NO_GRAVITY, x, y)
    }

    private fun hide() {
        val previous = popup
        popup = null
        list = null
        previous?.dismiss()
    }

    fun close() {
        val current = query
        query = null
        target = null
        pending = null
        literal = ""
        rows = emptyList()
        buckets = emptyList()
        frontier = null
        activeBucket = null
        val previous = popup
        popup = null
        list = null
        previous?.dismiss()
        if (current != null) emit(MenuEvent(Action.Closed, query = current))
    }
}
