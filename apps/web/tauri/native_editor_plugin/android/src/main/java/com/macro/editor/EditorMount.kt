package com.macro.editor

import android.graphics.Rect
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.webkit.WebView
import android.widget.FrameLayout
import kotlin.math.roundToInt

/** Bounds are visual-viewport CSS coordinates; clipping comes from the web scroll owners. */
data class EditorBounds(
    val left: Double,
    val top: Double,
    val width: Double,
    val height: Double,
    val viewportWidth: Double,
    val clipLeft: Double,
    val clipTop: Double,
    val clipRight: Double,
    val clipBottom: Double,
    val visible: Boolean,
)

/** A placement owns only its view; the session owner drains Stop before destroying the session. */
internal class EditorMount(
    private val webView: WebView,
    private val editor: NativeEditorView,
    val generation: Long,
) {
    private val parent = requireNotNull(webView.parent as? FrameLayout)
    private val clip = FrameLayout(webView.context)
    private var closed = false

    init {
        clip.clipChildren = true
        clip.clipToPadding = true
        clip.visibility = View.GONE
        clip.addView(editor)
        parent.addView(clip, parent.indexOfChild(webView) + 1)
    }

    fun update(requestGeneration: Long, bounds: EditorBounds) {
        if (closed || requestGeneration != generation) return
        require(listOf(bounds.left, bounds.top, bounds.width, bounds.height, bounds.viewportWidth,
            bounds.clipLeft, bounds.clipTop, bounds.clipRight, bounds.clipBottom).all { it.isFinite() })
        require(bounds.width >= 0 && bounds.height >= 0 && bounds.viewportWidth > 0)
        if (!bounds.visible || !webView.isShown || webView.width == 0) {
            hide()
            return
        }
        val scale = webView.width / bounds.viewportWidth
        val location = IntArray(2)
        val parentLocation = IntArray(2)
        webView.getLocationOnScreen(location)
        parent.getLocationOnScreen(parentLocation)
        val originX = location[0] - parentLocation[0]
        val originY = location[1] - parentLocation[1]
        val editorRect = Rect(
            originX + (bounds.left * scale).roundToInt(),
            originY + (bounds.top * scale).roundToInt(),
            originX + ((bounds.left + bounds.width) * scale).roundToInt(),
            originY + ((bounds.top + bounds.height) * scale).roundToInt(),
        )
        val visibleRect = Rect(
            originX + (bounds.clipLeft * scale).roundToInt(),
            originY + (bounds.clipTop * scale).roundToInt(),
            originX + (bounds.clipRight * scale).roundToInt(),
            originY + (bounds.clipBottom * scale).roundToInt(),
        )
        if (!visibleRect.intersect(editorRect)) {
            hide()
            return
        }
        val webClip = Rect()
        if (!webView.getGlobalVisibleRect(webClip)) {
            hide()
            return
        }
        webClip.offset(-parentLocation[0], -parentLocation[1])
        if (!visibleRect.intersect(webClip)) {
            hide()
            return
        }
        clip.layoutParams = FrameLayout.LayoutParams(visibleRect.width(), visibleRect.height()).apply {
            leftMargin = visibleRect.left
            topMargin = visibleRect.top
        }
        editor.layoutParams = FrameLayout.LayoutParams(editorRect.width(), editorRect.height()).apply {
            leftMargin = editorRect.left - visibleRect.left
            topMargin = editorRect.top - visibleRect.top
        }
        clip.visibility = View.VISIBLE
    }

    fun focus(requestGeneration: Long, focused: Boolean) {
        if (closed || requestGeneration != generation) return
        if (!focused) {
            editor.clearFocus()
            return
        }
        if (clip.visibility == View.VISIBLE && editor.requestFocus()) {
            editor.context.getSystemService(InputMethodManager::class.java)
                .showSoftInput(editor, InputMethodManager.SHOW_IMPLICIT)
        }
    }

    private fun hide() {
        if (editor.hasFocus()) {
            editor.context.getSystemService(InputMethodManager::class.java)
                .hideSoftInputFromWindow(editor.windowToken, 0)
            editor.clearFocus()
        }
        clip.visibility = View.GONE
    }

    fun close() {
        if (closed) return
        hide()
        closed = true
        parent.removeView(clip)
    }
}
