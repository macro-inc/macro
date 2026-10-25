package com.macro.call

import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.OnPictureInPictureModeChangedProvider
import androidx.core.app.OnUserLeaveHintProvider
import androidx.core.app.PictureInPictureModeChangedInfo
import androidx.core.graphics.Insets
import androidx.core.util.Consumer
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import io.livekit.android.renderer.TextureViewRenderer
import io.livekit.android.room.track.VideoTrack
import livekit.org.webrtc.RendererCommon
import kotlin.math.hypot

/**
 * The iOS call thumbnail over Macro's WebView: tap reopens the drawer, drag snaps it to a corner, and
 * dragging it past a side tucks it into an edge tab. Leaving Macro turns this activity into the call's
 * PiP window, the Android counterpart of iOS starting PiP from the inline thumbnail.
 */
internal class CallMiniWindow(private val activity: Activity, private val webView: View) {
    private val root: FrameLayout = activity.findViewById(android.R.id.content)
    private val thumbnail = FrameLayout(activity).apply {
        tag = "call-mini-window"; contentDescription = "Return to call"; clipToOutline = true; visibility = View.GONE
    }
    private val edgeTab = TextView(activity).apply {
        tag = "call-edge-tab"; contentDescription = "Show call"; text = "‹"; textSize = 18f
        typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER; visibility = View.GONE
    }
    private val pip = FrameLayout(activity).apply { visibility = View.GONE }
    private val renderers = mutableListOf<Pair<VideoTrack, TextureViewRenderer>>()
    private var rendered: List<Any?>? = null
    private var left = false
    private var top = true
    private var dragging = false
    private var inPictureInPicture = false
    private val callback: () -> Unit = { render() }
    private val layoutListener = View.OnLayoutChangeListener { _, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom ->
        if (!dragging && (right - left != oldRight - oldLeft || bottom - top != oldBottom - oldTop)) place()
    }
    // Android 12+ enters PiP from the auto-enter params; older versions need the leave hint.
    private val leaveHint = Runnable {
        if (Build.VERSION.SDK_INT < 31 && pictureInPictureAllowed()) runCatching { activity.enterPictureInPictureMode(CallPictureInPicture.params(activity)) }
    }
    private val pictureInPictureListener = Consumer<PictureInPictureModeChangedInfo> { info -> pictureInPictureChanged(info.isInPictureInPictureMode) }

    init {
        root.addView(thumbnail, FrameLayout.LayoutParams(dp(160), dp(112), Gravity.TOP or Gravity.START))
        root.addView(edgeTab, FrameLayout.LayoutParams(dp(34), dp(72), Gravity.END or Gravity.CENTER_VERTICAL))
        root.addView(pip, FrameLayout.LayoutParams(-1, -1))
        root.addOnLayoutChangeListener(layoutListener)
        thumbnail.setOnClickListener { Calls.openDrawer(activity) }
        edgeTab.setOnClickListener { Calls.setOverlay("minimized") }
        val slop = ViewConfiguration.get(activity).scaledTouchSlop
        var downX = 0f; var downY = 0f; var startX = 0f; var startY = 0f
        thumbnail.setOnTouchListener { view, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> { downX = event.rawX; downY = event.rawY; startX = view.x; startY = view.y; dragging = false; view.animate().cancel() }
                MotionEvent.ACTION_MOVE -> {
                    if (!dragging && hypot(event.rawX - downX, event.rawY - downY) > slop) dragging = true
                    if (dragging) { view.x = startX + event.rawX - downX; view.y = startY + event.rawY - downY }
                }
                MotionEvent.ACTION_UP -> if (dragging) settle() else view.performClick()
                MotionEvent.ACTION_CANCEL -> if (dragging) settle()
            }
            true
        }
        (activity as? OnUserLeaveHintProvider)?.addOnUserLeaveHintListener(leaveHint)
        (activity as? OnPictureInPictureModeChangedProvider)?.addOnPictureInPictureModeChangedListener(pictureInPictureListener)
        Calls.miniWindowChanged = callback
        render()
    }

    private fun dp(value: Int) = (value * activity.resources.displayMetrics.density).toInt()

    private fun pictureInPictureAllowed() = Calls.room != null && Calls.overlay == "minimized" && !CallActivity.isOpen &&
        activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

    private fun pictureInPictureChanged(active: Boolean) {
        inPictureInPicture = active
        // Hidden, the WebView keeps its size instead of re-laying out Macro at PiP size.
        webView.visibility = if (active) View.GONE else View.VISIBLE
        rendered = null
        render()
        // Expanding PiP opens the drawer, as iOS does when restoring; closing PiP leaves the activity stopped.
        val expanded = (activity as? LifecycleOwner)?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.STARTED) == true
        if (!active && expanded) Calls.openDrawer(activity)
    }

    // Auto-enter PiP only while the thumbnail is showing, animating from its bounds.
    private fun updatePictureInPicture() {
        if (Build.VERSION.SDK_INT < 31 || inPictureInPicture) return
        val allowed = pictureInPictureAllowed() && thumbnail.isShown
        val source = Rect().takeIf { allowed && thumbnail.getGlobalVisibleRect(it) }
        // Builds whose main activity can't enter PiP reject the params.
        runCatching { activity.setPictureInPictureParams(CallPictureInPicture.params(activity, source, autoEnter = allowed)) }
    }

    private fun settle() {
        dragging = false
        val centerX = thumbnail.x + thumbnail.width / 2
        if (centerX > root.width + dp(24) || centerX < -dp(24)) {
            Calls.setOverlay("hidden")
            return
        }
        left = centerX < root.width / 2
        top = thumbnail.y + thumbnail.height / 2 < root.height / 2
        place(animate = true)
    }

    // iOS geometry: under the status bar at the top, clear of the bottom navigation at the bottom.
    private fun place(animate: Boolean = false) {
        if (root.width == 0) return
        val bars = ViewCompat.getRootWindowInsets(root)?.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()) ?: Insets.NONE
        val x = if (left) bars.left + dp(8) else root.width - bars.right - dp(8) - dp(160)
        val y = if (top) bars.top else root.height - bars.bottom - dp(8) - dp(112) - dp(88)
        if (animate) thumbnail.animate().x(x.toFloat()).y(y.toFloat()).setDuration(200).withEndAction { updatePictureInPicture() }.start()
        else { thumbnail.x = x.toFloat(); thumbnail.y = y.toFloat(); thumbnail.post(::updatePictureInPicture) }
    }

    private fun video(track: VideoTrack, mirror: Boolean) = TextureViewRenderer(activity).also { renderer ->
        Calls.room?.initVideoRenderer(renderer)
        renderer.setMirror(mirror)
        renderer.setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
        track.addRenderer(renderer)
        renderers.add(track to renderer)
    }

    private fun detach() {
        renderers.forEach { (track, renderer) -> track.removeRenderer(renderer); renderer.release() }
        renderers.clear()
    }

    private fun half(title: String?, track: VideoTrack?, mirror: Boolean, theme: CallTheme) = FrameLayout(activity).apply {
        if (track != null) {
            addView(video(track, mirror), FrameLayout.LayoutParams(-1, -1))
            return@apply
        }
        val label = TextView(activity).apply { setTextColor(theme.text); gravity = Gravity.CENTER; typeface = Typeface.DEFAULT_BOLD }
        if (title == null) {
            label.text = "No one\nelse is here"; label.textSize = 11f
            addView(label, FrameLayout.LayoutParams(-1, -2, Gravity.CENTER).apply { leftMargin = dp(8); rightMargin = dp(8) })
        } else {
            label.text = Calls.initials(title); label.textSize = 18f
            label.background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(theme.edgeMuted) }
            addView(label, FrameLayout.LayoutParams(dp(44), dp(44), Gravity.CENTER))
        }
    }

    fun render() {
        val media = Calls.room
        if (media == null && inPictureInPicture) {
            // The call ended in PiP; there is nothing left to show.
            activity.moveTaskToBack(false)
            return
        }
        val theme = Calls.drawerTheme ?: CallTheme.load(activity)
        val spotlight = media?.let { Calls.spotlight(it) }
        val showThumbnail = media != null && Calls.overlay == "minimized" && !inPictureInPicture
        // iOS offers the edge tab only once someone else is in the call.
        val showTab = media != null && Calls.overlay == "hidden" && spotlight != null && !inPictureInPicture
        val localTrack = if (Calls.video) media?.localParticipant?.let { Calls.cameraTrack(it) } else null
        val next = listOf(showThumbnail, showTab, inPictureInPicture, theme, media?.let { Calls.localName(it) }, localTrack,
            spotlight?.let { Calls.displayName(it) }, spotlight?.let { Calls.cameraTrack(it) }, Calls.muted, CallActivity.isOpen)
        if (next == rendered) return
        rendered = next
        detach(); thumbnail.removeAllViews(); pip.removeAllViews()
        edgeTab.visibility = if (showTab) View.VISIBLE else View.GONE
        edgeTab.setTextColor(theme.text)
        edgeTab.background = GradientDrawable().apply { setColor(theme.edgeMuted); cornerRadius = dp(10).toFloat() }
        if (showTab) edgeTab.bringToFront()
        pip.visibility = if (inPictureInPicture) View.VISIBLE else View.GONE
        if (inPictureInPicture && media != null) {
            activity.setPictureInPictureParams(CallPictureInPicture.params(activity))
            pip.addView(CallPictureInPicture.view(activity, Calls.localName(media), localTrack, spotlight?.let { Calls.displayName(it) },
                spotlight?.let { Calls.cameraTrack(it) }, ::video), FrameLayout.LayoutParams(-1, -1))
            pip.bringToFront()
        }
        if (!showThumbnail) { thumbnail.visibility = View.GONE; updatePictureInPicture(); return }
        thumbnail.background = GradientDrawable().apply { setColor(theme.tile); cornerRadius = dp(12).toFloat(); setStroke(dp(1), theme.edge) }
        val halves = LinearLayout(activity)
        halves.addView(half(media?.let { Calls.localName(it) }, localTrack, true, theme), LinearLayout.LayoutParams(0, -1, 1f))
        halves.addView(View(activity).apply { setBackgroundColor(theme.edge) }, LinearLayout.LayoutParams(dp(1), -1))
        halves.addView(half(spotlight?.let { Calls.displayName(it) }, spotlight?.let { Calls.cameraTrack(it) }, false, theme), LinearLayout.LayoutParams(0, -1, 1f))
        thumbnail.addView(halves, FrameLayout.LayoutParams(-1, -1))
        thumbnail.visibility = View.VISIBLE
        thumbnail.bringToFront()
        // A speaker change mid-drag must not snap the thumbnail out from under the finger.
        if (!dragging) place()
    }

    fun release() {
        if (Calls.miniWindowChanged === callback) Calls.miniWindowChanged = null
        (activity as? OnUserLeaveHintProvider)?.removeOnUserLeaveHintListener(leaveHint)
        (activity as? OnPictureInPictureModeChangedProvider)?.removeOnPictureInPictureModeChangedListener(pictureInPictureListener)
        root.removeOnLayoutChangeListener(layoutListener)
        detach()
        root.removeView(thumbnail); root.removeView(edgeTab); root.removeView(pip)
    }
}
