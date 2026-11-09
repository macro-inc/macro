package com.macro.editor

import android.content.Context
import android.os.Looper
import android.text.Editable
import android.text.TextWatcher
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputConnectionWrapper
import androidx.appcompat.widget.AppCompatEditText
import com.macro.documentsession.*

/** Platform I/O runs after handle returns, and reports real completions back to admit. */
interface NativeEditorHost {
    fun now(): FfiNow
    fun execute(output: FfiOutput, admit: (FfiInput) -> Unit)
    fun viewEffect(effect: FfiViewEffect)
    fun failed(error: Exception)
}

/** Android owns text input and accessibility; Rust owns the document and history. */
class NativeEditorView(
    context: Context,
    private val session: NativeEditorSessionInterface,
    private val host: NativeEditorHost,
    initiallyEditable: Boolean,
    initiallyInteractable: Boolean,
) : AppCompatEditText(context) {
    private val clipboard = EditorClipboard(context)
    private val projection = EditorProjection()
    private var projectionLayout = projection.layout()
    private var applying = false
    private var initialized = false
    private var ready = false
    private var inputGeneration = 0L
    private var composing = false
    private var platformEnter = false
    private var editable = initiallyEditable
    private var interactable = initiallyInteractable
    private var editingKeyListener: android.text.method.KeyListener? = null
    private var changedStart = 0
    private var changedCount = 0
    private var removedCount = 0
    private var replacedSelection: ViewSelection = ViewSelection.KeepModel
    private val spans = EditorSpans()

    init {
        val types = session.query(FfiQuery.TypeTable)
        require(types is FfiQueryReply.Types)
        projection.registerTypes(types.rows)
        initialized = true
        setPadding(0, 0, 0, 0)
        background = null
        gravity = android.view.Gravity.TOP or android.view.Gravity.START
        inputType = android.text.InputType.TYPE_CLASS_TEXT or
            android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE or
            android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        editingKeyListener = keyListener
        setEditable(initiallyEditable)
        addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(value: CharSequence?, start: Int, count: Int, after: Int) {
                if (applying) return
                changedStart = start
                changedCount = after
                removedCount = count
                replacedSelection = projectionLayout.selection(start, start + count)
            }

            override fun onTextChanged(value: CharSequence?, start: Int, before: Int, count: Int) = Unit

            override fun afterTextChanged(value: Editable?) {
                if (applying || value == null) return
                if (!ready || !canEditContent()) {
                    applying = true
                    try { render() } finally { applying = false }
                    return
                }
                val inserted = value.subSequence(changedStart, changedStart + changedCount).toString()
                val range = projectionLayout.ranges.firstOrNull {
                    changedStart >= it.start && changedStart + removedCount <= it.end
                }
                val policy = session.query(FfiQuery.ShouldInsertText(inserted)) as FfiQueryReply.Boolean
                if (range != null && !inserted.contains('\n') && !policy.value) {
                    val anchor = (selectionStart - range.start).takeIf { it >= 0 }?.toUInt()
                    val focus = (selectionEnd - range.start).takeIf { it >= 0 }?.toUInt()
                    admit(FfiInput.TextDeltaFromView(ViewTextDelta(
                        range.key, (changedStart - range.start).toUInt(), removedCount.toUInt(), inserted,
                        anchor, focus, false, null, ViewSelection.KeepModel,
                    )))
                    return
                }
                if (inserted == "\n" && !composing && !platformEnter && routeEnter(
                    FfiKeyEvent("Enter", "Enter", false, false, false, false, false, false), replacedSelection)) {
                    applying = true
                    try { render() } finally { applying = false }
                    return
                }
                val command = when (inserted) {
                    "\n" -> FfiCommand.InsertParagraph
                    else -> FfiCommand.InsertText(inserted)
                }
                admit(FfiInput.Command(command, replacedSelection))
            }
        })
        setOnFocusChangeListener { _, focused ->
            if (!focused) {
                if (ready && !applying) finishComposition()
                inputGeneration++
                BaseInputConnectionCompat.finish(text)
                if (applying) composing = false
            }
            if (ready && !applying) admit(FfiInput.Focus(focused))
        }
    }

    /** Repaint an already seeded session without replacing its document or history. */
    fun attachRunningSession() {
        check(Looper.myLooper() == Looper.getMainLooper())
        val current = session.query(FfiQuery.ViewDiff) as FfiQueryReply.ViewDiff
        applying = true
        try {
            projection.apply(current.diff)
            ready = true
            setEditable(editable)
            render()
            val selection = current.selection
            if (selection is ViewSelection.Range) {
                val anchor = projectionLayout.offset(selection.anchor)
                val focus = projectionLayout.offset(selection.focus)
                if (anchor != null && focus != null) setSelection(anchor, focus)
            }
        } finally { applying = false }
    }

    fun admit(input: FfiInput) { handle(input) }

    private fun handle(input: FfiInput): FfiOutput? {
        check(Looper.myLooper() == Looper.getMainLooper())
        var admitted: FfiOutput? = null
        return try {
            val output = session.handle(host.now(), input)
            admitted = output
            try {
                val rejected = output.view.any { it is FfiViewEffect.Error }
                val displayedText = if (rejected) null else when (input) {
                    is FfiInput.TextFromView -> input.key to input.text
                    is FfiInput.TextDeltaFromView -> {
                        val delta = input.delta
                        val old = requireNotNull(projection.nodes[delta.key]).text
                        val offset = delta.offset.toInt()
                        delta.key to old.replaceRange(offset, offset + delta.deleted.toInt(), delta.inserted)
                    }
                    else -> null
                }
                apply(output, displayedText)
            } finally { host.execute(output, ::admit) }
            output
        } catch (error: Exception) {
            host.failed(error)
            admitted
        }
    }

    /** Session-lifetime I/O may publish a correction while this view is mounted. */
    fun acceptOutput(output: FfiOutput) {
        check(Looper.myLooper() == Looper.getMainLooper())
        apply(output, null)
    }

    private fun apply(output: FfiOutput, displayedText: Pair<NodeKey, String>?) {
        applying = true
        try {
            // DOM-first/native-first inputs can elide their entire text diff. Keep
            // the view cache current before applying model corrections and selection.
            val rejected = output.view.any { it is FfiViewEffect.Error }
            var repaint = displayedText != null
            if (!rejected) displayedText?.let { projection.acceptDisplayedText(it.first, it.second) }
            var selection: ViewSelection? = null
            for (effect in output.view) {
                when (effect) {
                    is FfiViewEffect.Initialize -> {
                        projection.apply(effect.diff, displayedText)
                        ready = true
                        setEditable(editable)
                        repaint = true
                    }
                    is FfiViewEffect.Diff -> { projection.apply(effect.diff, displayedText); repaint = true }
                    is FfiViewEffect.SetSelection -> selection = effect.selection
                    FfiViewEffect.EndComposition -> {
                        BaseInputConnectionCompat.finish(text)
                        composing = false
                    }
                    else -> host.viewEffect(effect)
                }
            }
            if (rejected) {
                val current = session.query(FfiQuery.ViewDiff)
                require(current is FfiQueryReply.ViewDiff)
                projection.apply(current.diff)
                repaint = true
            }
            if (repaint) render()
            when (val resolved = selection) {
                is ViewSelection.Range -> {
                    val anchor = projectionLayout.offset(resolved.anchor)
                    val focus = projectionLayout.offset(resolved.focus)
                    if (anchor != null && focus != null) setSelection(anchor, focus)
                }
                ViewSelection.None -> clearFocus()
                else -> Unit
            }
        } finally {
            applying = false
        }
    }

    private fun render() {
        projectionLayout = projection.layout()
        val editable = requireNotNull(text)
        if (editable.toString() != projectionLayout.text) {
            var prefix = 0
            while (prefix < editable.length && prefix < projectionLayout.text.length &&
                editable[prefix] == projectionLayout.text[prefix]) prefix++
            // Never split a UTF-16 surrogate pair at a patch boundary.
            if (prefix > 0 && prefix < editable.length && Character.isLowSurrogate(editable[prefix])) prefix--
            var oldEnd = editable.length
            var newEnd = projectionLayout.text.length
            while (oldEnd > prefix && newEnd > prefix && editable[oldEnd - 1] == projectionLayout.text[newEnd - 1]) {
                oldEnd--; newEnd--
            }
            if (oldEnd > prefix && oldEnd < editable.length && Character.isLowSurrogate(editable[oldEnd])) {
                oldEnd++; newEnd++
            }
            editable.replace(prefix, oldEnd, projectionLayout.text.substring(prefix, newEnd))
        }
        spans.apply(editable, projection, projectionLayout)
    }

    override fun onSelectionChanged(start: Int, end: Int) {
        super.onSelectionChanged(start, end)
        // Android may call this override from its superclass constructor.
        if (initialized && ready && !applying && start >= 0 && end >= 0 &&
            start <= projectionLayout.text.length && end <= projectionLayout.text.length &&
            text?.toString() == projectionLayout.text) {
            admit(FfiInput.SelectionFromView(projectionLayout.selection(start, end), null))
        }
    }

    fun setEditable(value: Boolean) {
        if (editable != value) inputGeneration++
        editable = value
        val wasApplying = applying
        val anchor = selectionStart
        val focus = selectionEnd
        applying = true
        try {
            keyListener = if (canEditContent() && ready) editingKeyListener else null
            isCursorVisible = canEditContent() && ready
            setTextIsSelectable(true)
            if (anchor >= 0 && focus >= 0 && anchor <= length() && focus <= length()) {
                setSelection(anchor, focus)
            }
        } finally { applying = wasApplying }
        if (!canEditContent()) finishComposition()
    }

    /** Content locks are independent of editor editability and comment-mark capability. */
    fun setContentInteractable(value: Boolean) {
        if (interactable != value) inputGeneration++
        interactable = value
        setEditable(editable)
    }

    internal fun detachFromSession() {
        setEditable(false)
        ready = false
        inputGeneration++
    }

    private fun canEditContent() = editable && interactable
    internal fun acceptsInput() = ready && canEditContent()

    private fun routeEnter(event: FfiKeyEvent, selection: ViewSelection): Boolean {
        val output = handle(FfiInput.KeyDown(event, FfiCommand.Key(KeyCommand.ENTER, event), false, selection))
        return output?.view?.any { it is FfiViewEffect.PreventDefault } == true
    }

    override fun onKeyDown(keyCode: Int, event: android.view.KeyEvent): Boolean {
        if (ready && canEditContent() && !composing &&
            (keyCode == android.view.KeyEvent.KEYCODE_ENTER || keyCode == android.view.KeyEvent.KEYCODE_NUMPAD_ENTER)) {
            val facts = FfiKeyEvent("Enter", if (keyCode == android.view.KeyEvent.KEYCODE_NUMPAD_ENTER) "NumpadEnter" else "Enter",
                event.isShiftPressed, event.isAltPressed, event.isCtrlPressed, event.isMetaPressed,
                event.repeatCount > 0, false)
            if (routeEnter(facts, projectionLayout.selection(selectionStart, selectionEnd))) return true
            platformEnter = true
            try { return super.onKeyDown(keyCode, event) } finally { platformEnter = false }
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyShortcut(keyCode: Int, event: android.view.KeyEvent): Boolean {
        if (canEditContent() && (event.isCtrlPressed || event.isMetaPressed)) {
            val command = when (keyCode) {
                android.view.KeyEvent.KEYCODE_Z -> if (event.isShiftPressed) FfiCommand.Redo else FfiCommand.Undo
                android.view.KeyEvent.KEYCODE_Y -> FfiCommand.Redo
                android.view.KeyEvent.KEYCODE_B -> FfiCommand.FormatText(TextFormatType.BOLD)
                android.view.KeyEvent.KEYCODE_I -> FfiCommand.FormatText(TextFormatType.ITALIC)
                android.view.KeyEvent.KEYCODE_U -> FfiCommand.FormatText(TextFormatType.UNDERLINE)
                else -> null
            }
            if (command != null) {
                admit(FfiInput.Command(command, projectionLayout.selection(selectionStart, selectionEnd)))
                return true
            }
        }
        return super.onKeyShortcut(keyCode, event)
    }

    override fun onTextContextMenuItem(id: Int): Boolean {
        if (!ready) return false
        when (id) {
            android.R.id.paste, android.R.id.pasteAsPlainText -> {
                if (!canEditContent()) return false
                val payload = clipboard.read() ?: return false
                val data = if (id == android.R.id.pasteAsPlainText) {
                    payload.copy(
                        data = payload.data.filter { it.mime == "text/plain" } +
                            clipboardPasteFacts(FfiPasteFacts(0u, true, false, false)),
                        hasFiles = false,
                        htmlNodes = null,
                    )
                } else payload
                admit(FfiInput.Paste(data, projectionLayout.selection(selectionStart, selectionEnd)))
                return true
            }
            android.R.id.copy, android.R.id.cut -> {
                if (id == android.R.id.cut && !canEditContent()) return false
                admit(FfiInput.SelectionFromView(
                    projectionLayout.selection(selectionStart, selectionEnd), null))
                val reply = session.query(FfiQuery.Clipboard) as FfiQueryReply.Clipboard
                if (!clipboard.write(reply.entries)) return false
                if (id == android.R.id.cut) {
                    admit(FfiInput.Command(FfiCommand.RemoveText, ViewSelection.KeepModel))
                }
                return true
            }
            android.R.id.undo -> { if (!canEditContent()) return false; admit(FfiInput.Undo); return true }
            android.R.id.redo -> { if (!canEditContent()) return false; admit(FfiInput.Redo); return true }
        }
        return super.onTextContextMenuItem(id)
    }

    private fun finishComposition() {
        if (!composing) return
        composing = false
        BaseInputConnectionCompat.finish(text)
        if (!canEditContent()) {
            admit(FfiInput.Composition(CompositionEvent.Clear, ViewSelection.KeepModel))
            return
        }
        val point = projectionLayout.point(selectionStart.coerceIn(0, projectionLayout.text.length))
        if (point is Point.Text) {
            val end = projectionLayout.point(selectionEnd.coerceIn(0, projectionLayout.text.length))
            val focus = (end as? Point.Text)?.takeIf { it.key == point.key }?.offset
            admit(FfiInput.TextDeltaFromView(ViewTextDelta(
                point.key, point.offset, 0u, "", point.offset, focus,
                true, "", ViewSelection.KeepModel,
            )))
        } else {
            admit(FfiInput.Composition(CompositionEvent.Clear, ViewSelection.KeepModel))
        }
    }

    override fun onCreateInputConnection(info: EditorInfo): InputConnection? {
        if (!ready || !canEditContent()) return null
        val connection = super.onCreateInputConnection(info) ?: return null
        val generation = ++inputGeneration
        fun current() = ready && canEditContent() && generation == inputGeneration
        fun composingText(value: CharSequence?) {
            if (!composing) {
                composing = true
                admit(FfiInput.Composition(CompositionEvent.Start(value?.toString() ?: ""),
                    projectionLayout.selection(selectionStart, selectionEnd)))
            }
        }
        fun composingRegion(start: Int, end: Int): Boolean {
            if (start < 0 || end < 0 || start > length() || end > length()) return false
            if (!composing) {
                composing = true
                admit(FfiInput.Composition(CompositionEvent.Start(""),
                    projectionLayout.selection(start, end)))
            }
            return true
        }
        fun commit(value: CharSequence?, operation: () -> Boolean): Boolean {
            val previousEnter = platformEnter
            if (!platformEnter && value?.toString() == "\n" && !composing) {
                if (routeEnter(FfiKeyEvent("Enter", "Enter", false, false, false, false, false, false),
                    projectionLayout.selection(selectionStart, selectionEnd))) return true
                platformEnter = true
            }
            try { return operation() } finally { platformEnter = previousEnter }
        }
        val guarded = object : InputConnectionWrapper(connection, false) {
            private var batches = 0
            override fun beginBatchEdit(): Boolean {
                if (!current()) return false
                return super.beginBatchEdit().also { if (it) batches++ }
            }
            override fun endBatchEdit(): Boolean {
                if (batches == 0 && !current()) return false
                if (batches > 0) batches--
                return super.endBatchEdit()
            }
            override fun closeConnection() {
                if (!current()) {
                    while (batches > 0) {
                        batches--
                        super.endBatchEdit()
                    }
                    return
                }
                finishComposition()
                inputGeneration++
                batches = 0
                super.closeConnection()
            }
            override fun setSelection(start: Int, end: Int): Boolean = current() && super.setSelection(start, end)
            override fun sendKeyEvent(event: android.view.KeyEvent): Boolean = current() && super.sendKeyEvent(event)
            override fun performContextMenuAction(id: Int): Boolean = current() && super.performContextMenuAction(id)
            override fun performEditorAction(action: Int): Boolean = current() && super.performEditorAction(action)
            override fun performPrivateCommand(action: String?, data: android.os.Bundle?): Boolean = current() && super.performPrivateCommand(action, data)
            override fun clearMetaKeyStates(states: Int): Boolean = current() && super.clearMetaKeyStates(states)
            override fun reportFullscreenMode(enabled: Boolean): Boolean = current() && super.reportFullscreenMode(enabled)
            override fun requestCursorUpdates(mode: Int): Boolean = current() && super.requestCursorUpdates(mode)
            override fun getTextBeforeCursor(length: Int, flags: Int): CharSequence? = if (current()) super.getTextBeforeCursor(length, flags) else null
            override fun getTextAfterCursor(length: Int, flags: Int): CharSequence? = if (current()) super.getTextAfterCursor(length, flags) else null
            override fun getSelectedText(flags: Int): CharSequence? = if (current()) super.getSelectedText(flags) else null
            override fun getCursorCapsMode(modes: Int): Int = if (current()) super.getCursorCapsMode(modes) else 0
            override fun getExtractedText(request: android.view.inputmethod.ExtractedTextRequest?, flags: Int): android.view.inputmethod.ExtractedText? =
                if (current()) super.getExtractedText(request, flags) else null
            override fun commitCompletion(value: android.view.inputmethod.CompletionInfo?): Boolean {
                if (!current()) return false
                return super.commitCompletion(value).also { if (it) finishComposition() }
            }
            override fun commitCorrection(value: android.view.inputmethod.CorrectionInfo?): Boolean = current() && super.commitCorrection(value)
            override fun setComposingText(value: CharSequence?, newCursorPosition: Int): Boolean {
                if (!current()) return false
                composingText(value)
                return super.setComposingText(value, newCursorPosition)
            }

            override fun setComposingRegion(start: Int, end: Int): Boolean {
                if (!current() || !composingRegion(start, end)) return false
                return super.setComposingRegion(start, end)
            }

            override fun commitText(value: CharSequence?, newCursorPosition: Int): Boolean {
                if (!current()) return false
                return commit(value) {
                    val committed = super.commitText(value, newCursorPosition)
                    if (committed) finishComposition()
                    committed
                }
            }

            override fun deleteSurroundingText(beforeLength: Int, afterLength: Int): Boolean {
                if (!current() || beforeLength < 0 || afterLength < 0) return false
                val value = text ?: return false
                var start = minOf(selectionStart, selectionEnd)
                var end = maxOf(selectionStart, selectionEnd)
                if (start < 0 || end > value.length) return false
                val composingStart = android.view.inputmethod.BaseInputConnection.getComposingSpanStart(value)
                val composingEnd = android.view.inputmethod.BaseInputConnection.getComposingSpanEnd(value)
                if (composingStart >= 0 && composingEnd >= 0) {
                    start = minOf(start, composingStart, composingEnd)
                    end = maxOf(end, composingStart, composingEnd)
                }
                var from = (start.toLong() - beforeLength).coerceAtLeast(0L).toInt()
                var through = (end.toLong() + afterLength).coerceAtMost(value.length.toLong()).toInt()
                if (from > 0 && from < value.length && Character.isLowSurrogate(value[from])) from--
                if (through > 0 && through < value.length && Character.isLowSurrogate(value[through])) through++
                return super.deleteSurroundingText(start - from, through - end)
            }

            override fun deleteSurroundingTextInCodePoints(beforeLength: Int, afterLength: Int): Boolean {
                if (!current()) return false
                return super.deleteSurroundingTextInCodePoints(beforeLength, afterLength)
            }

            override fun finishComposingText(): Boolean {
                if (!current()) return false
                val finished = super.finishComposingText()
                if (finished) finishComposition()
                return finished
            }
        }
        return modernInputConnection(guarded, ::current, ::composingText, ::composingRegion, ::finishComposition, ::commit)
    }
}

private object BaseInputConnectionCompat {
    fun finish(value: Editable?) {
        if (value != null) android.view.inputmethod.BaseInputConnection.removeComposingSpans(value)
    }
}
