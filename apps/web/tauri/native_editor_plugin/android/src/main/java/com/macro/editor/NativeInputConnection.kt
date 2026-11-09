package com.macro.editor

import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.view.inputmethod.*
import androidx.annotation.DoNotInline
import androidx.annotation.RequiresApi
import java.util.concurrent.Executor
import java.util.function.Consumer
import java.util.function.IntConsumer

/** Keep API-specific signatures out of classes loaded on Android 24. */
internal fun modernInputConnection(
    input: InputConnection,
    current: () -> Boolean,
    composingText: (CharSequence?) -> Unit,
    composingRegion: (Int, Int) -> Boolean,
    committed: () -> Unit,
): InputConnection {
    var connection = input
    if (Build.VERSION.SDK_INT >= 25) connection = InputApi25.wrap(connection, current)
    if (Build.VERSION.SDK_INT >= 31) connection = InputApi31.wrap(connection, current)
    if (Build.VERSION.SDK_INT >= 33) connection = InputApi33.wrap(connection, current, composingText, composingRegion, committed)
    if (Build.VERSION.SDK_INT >= 34) connection = InputApi34.wrap(connection, current, committed)
    return connection
}

@RequiresApi(25)
private object InputApi25 {
    @DoNotInline
    fun wrap(input: InputConnection, current: () -> Boolean): InputConnection =
        object : InputConnectionWrapper(input, false) {
            override fun commitContent(content: InputContentInfo, flags: Int, options: Bundle?): Boolean =
                current() && super.commitContent(content, flags, options)
        }
}

@RequiresApi(31)
private object InputApi31 {
    @DoNotInline
    fun wrap(input: InputConnection, current: () -> Boolean): InputConnection =
        object : InputConnectionWrapper(input, false) {
            override fun performSpellCheck(): Boolean = current() && super.performSpellCheck()
            override fun getSurroundingText(before: Int, after: Int, flags: Int): SurroundingText? =
                if (current()) super.getSurroundingText(before, after, flags) else null
        }
}

@RequiresApi(33)
private object InputApi33 {
    @DoNotInline
    fun wrap(input: InputConnection, current: () -> Boolean, composingText: (CharSequence?) -> Unit,
        composingRegion: (Int, Int) -> Boolean, committed: () -> Unit): InputConnection =
        object : InputConnectionWrapper(input, false) {
            override fun setComposingText(text: CharSequence, cursor: Int, attributes: TextAttribute?): Boolean {
                if (!current()) return false
                composingText(text)
                return super.setComposingText(text, cursor, attributes)
            }
            override fun setComposingRegion(start: Int, end: Int, attributes: TextAttribute?): Boolean {
                if (!current() || !composingRegion(start, end)) return false
                return super.setComposingRegion(start, end, attributes)
            }
            override fun commitText(text: CharSequence, cursor: Int, attributes: TextAttribute?): Boolean {
                if (!current()) return false
                return super.commitText(text, cursor, attributes).also { if (it) committed() }
            }
            override fun requestCursorUpdates(mode: Int, filter: Int): Boolean =
                current() && super.requestCursorUpdates(mode, filter)
            override fun setImeConsumesInput(consumes: Boolean): Boolean = current() && super.setImeConsumesInput(consumes)
            override fun takeSnapshot(): TextSnapshot? = if (current()) super.takeSnapshot() else null
        }
}

@RequiresApi(34)
private object InputApi34 {
    @DoNotInline
    fun wrap(input: InputConnection, current: () -> Boolean, committed: () -> Unit): InputConnection =
        object : InputConnectionWrapper(input, false) {
            override fun replaceText(start: Int, end: Int, text: CharSequence, cursor: Int, attributes: TextAttribute?): Boolean {
                if (!current()) return false
                return super.replaceText(start, end, text, cursor, attributes).also { if (it) committed() }
            }
            override fun performHandwritingGesture(gesture: HandwritingGesture, executor: Executor?, consumer: IntConsumer?) {
                if (!current()) {
                    if (executor != null && consumer != null) executor.execute {
                        consumer.accept(InputConnection.HANDWRITING_GESTURE_RESULT_CANCELLED)
                    }
                    return
                }
                super.performHandwritingGesture(gesture, executor, consumer)
            }
            override fun previewHandwritingGesture(gesture: PreviewableHandwritingGesture, signal: CancellationSignal?): Boolean {
                if (!current()) { signal?.cancel(); return false }
                return super.previewHandwritingGesture(gesture, signal)
            }
            override fun requestTextBoundsInfo(bounds: android.graphics.RectF, executor: Executor, consumer: Consumer<TextBoundsInfoResult>) {
                if (!current()) {
                    executor.execute { consumer.accept(TextBoundsInfoResult(TextBoundsInfoResult.CODE_CANCELLED)) }
                    return
                }
                super.requestTextBoundsInfo(bounds, executor, consumer)
            }
        }
}
