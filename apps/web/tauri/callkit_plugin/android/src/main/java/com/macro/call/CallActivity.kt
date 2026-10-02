package com.macro.call

import android.Manifest
import android.app.Activity
import android.app.PictureInPictureParams
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.telecom.CallAudioState
import android.util.Rational
import android.view.View
import android.view.WindowManager
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.graphics.ColorUtils
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.MotionEvent
import android.widget.*
import io.livekit.android.renderer.SurfaceViewRenderer
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.VideoTrack
import kotlinx.coroutines.launch

/** Native media UI also owns PiP: navigating/reloading the WebView never owns the room. */
class CallActivity : Activity() {
    private lateinit var layout: FrameLayout
    private var backCallback: android.window.OnBackInvokedCallback? = null
    private var pipRequested = false
    private var primaryId: String? = null
    private var swipeY = 0f
    private var stripScroll = 0
    private var participantStrip: HorizontalScrollView? = null
    private var theme: CallTheme? = null
    private data class ParticipantTile(val id: String, val name: String, val track: VideoTrack?, val local: Boolean = false)
    private val renderers = mutableListOf<Pair<VideoTrack, SurfaceViewRenderer>>()
    private var permissionAction: (() -> Unit)? = null
    private var permissionCallId: String? = null
    private var rendered: List<Any?>? = null
    private val callback: () -> Unit = { render() }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = android.window.OnBackInvokedCallback { dismissDrawer() }
            onBackInvokedDispatcher.registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback!!)
        }
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }
        else window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        theme = Calls.drawerTheme ?: CallTheme.load(this)
        window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))
        layout = FrameLayout(this)
        layout.addOnLayoutChangeListener { _, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom ->
            if (right - left != oldRight - oldLeft || bottom - top != oldBottom - oldTop) { rendered = null; render() }
        }
        ViewCompat.setOnApplyWindowInsetsListener(layout) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            rendered = null
            render()
            insets
        }
        setContentView(layout)
        Calls.changed = callback
        intent.getStringExtra("answer")?.let { id ->
            permission(Manifest.permission.RECORD_AUDIO, id) { Calls.answer(this, id) }
        }
        render()
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.getStringExtra("answer")?.let { id -> permission(Manifest.permission.RECORD_AUDIO, id) { Calls.answer(this, id) } }
        render()
    }
    private fun permission(name: String, callId: String? = null, action: () -> Unit) {
        if (permissionAction != null) {
            if (callId != permissionCallId) callId?.let { Calls.finishMicrophonePermission(it) }
            return
        }
        if (checkSelfPermission(name) == PackageManager.PERMISSION_GRANTED) {
            callId?.let { Calls.finishMicrophonePermission(it) }
            action()
            return
        }
        if (callId != null && !Calls.beginMicrophonePermission(callId)) return
        permissionCallId = callId
        permissionAction = action
        try { requestPermissions(arrayOf(name), 4) }
        catch (_: Exception) {
            permissionCallId?.let { Calls.finishMicrophonePermission(it) }
            permissionCallId = null; permissionAction = null
            Calls.error = "Could not request permission. Try again."; render()
        }
    }
    override fun onRequestPermissionsResult(code: Int, permissions: Array<out String>, grants: IntArray) {
        super.onRequestPermissionsResult(code, permissions, grants)
        if (code != 4 || permissionAction == null) return
        val action = permissionAction
        val callId = permissionCallId
        permissionAction = null; permissionCallId = null
        callId?.let { Calls.finishMicrophonePermission(it) }
        if (grants.firstOrNull() == PackageManager.PERMISSION_GRANTED) action?.invoke()
        else { Calls.error = "Permission denied. Enable it in Android settings to use this control."; render() }
    }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun background(color: Int, radius: Int = 16, border: Int? = null) = GradientDrawable().apply {
        setColor(color); cornerRadius = dp(radius).toFloat()
        border?.let { setStroke(dp(1), it) }
    }
    private fun label(value: String, size: Float = 14f, color: Int = theme!!.text) = TextView(this).apply {
        text = value; textSize = size; setTextColor(color); maxLines = 1; gravity = Gravity.CENTER_VERTICAL
        ellipsize = android.text.TextUtils.TruncateAt.END
    }
    private fun actionButton(value: String, color: Int, action: () -> Unit) = TextView(this).apply {
        text = value; textSize = 14f; gravity = Gravity.CENTER; setTextColor(Color.WHITE)
        background = background(color, 12); contentDescription = value
        setPadding(dp(16), 0, dp(16), 0); minimumHeight = dp(48)
        isClickable = true; isFocusable = true; setOnClickListener { action() }
    }
    private fun icon(kind: String, name: String, active: Boolean = false, off: Boolean = false, action: () -> Unit) = ImageButton(this).apply {
        setImageDrawable(CallControlIcon(kind, theme!!.text, off)); scaleType = ImageView.ScaleType.CENTER_INSIDE
        setPadding(dp(14), dp(14), dp(14), dp(14)); background = background(if (active) theme!!.edgeMuted else theme!!.drawer, 12, theme!!.edge)
        tag = "call-control-$kind"
        contentDescription = name; isSelected = active; setOnClickListener { action() }
    }
    private fun detach() { renderers.forEach { (track, renderer) -> track.removeRenderer(renderer); renderer.release() }; renderers.clear() }
    private fun tile(participant: ParticipantTile?, large: Boolean): FrameLayout = FrameLayout(this).apply {
        background = background(theme!!.tile, 16); clipToOutline = true
        tag = if (large) "call-primary" else "call-participant"
        val name = participant?.name ?: "Waiting for others"
        contentDescription = name
        participant?.track?.let { track ->
            val renderer = SurfaceViewRenderer(this@CallActivity)
            renderer.setZOrderMediaOverlay(true)
            renderer.setMirror(participant.local)
            Calls.room?.initVideoRenderer(renderer); track.addRenderer(renderer)
            renderers.add(track to renderer)
            addView(renderer, FrameLayout.LayoutParams(-1, -1))
        } ?: run {
            val initials = participant?.name?.split(' ')?.filter { it.isNotBlank() }?.take(2)?.joinToString("") { it.take(1).uppercase() } ?: ""
            val avatar = label(initials, if (large) 32f else 18f).apply {
                gravity = Gravity.CENTER; background = background(theme!!.edgeMuted, 100)
            }
            val size = dp(if (large) 88 else 40)
            addView(avatar, FrameLayout.LayoutParams(size, size, Gravity.CENTER))
        }
        addView(label(name, if (large) 14f else 11f).apply {
            gravity = Gravity.START or Gravity.CENTER_VERTICAL; setPadding(dp(8), dp(5), dp(8), dp(5))
            background = background(theme!!.edgeMuted, 8)
        }, FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.START).apply { bottomMargin = dp(10); leftMargin = dp(10); rightMargin = dp(10) })
        if (participant != null && !large) setOnClickListener { primaryId = participant.id; stripScroll = participantStrip?.scrollX ?: 0; rendered = null; render() }
        if (participant?.local == true && Calls.video && large) addView(icon("switch", "Switch camera") { Calls.switchCamera() },
            FrameLayout.LayoutParams(dp(48), dp(48), Gravity.TOP or Gravity.END).apply { topMargin = dp(8); rightMargin = dp(8) })
    }
    private fun render() {
        val call = Calls.offer ?: run { finish(); return }
        theme = Calls.drawerTheme ?: theme ?: CallTheme.load(this)
        val light = ColorUtils.calculateLuminance(theme!!.drawer) > 0.5
        WindowInsetsControllerCompat(window, layout).apply {
            isAppearanceLightNavigationBars = light; isAppearanceLightStatusBars = light
        }
        val media = Calls.room
        fun video(participant: io.livekit.android.room.participant.Participant): VideoTrack? {
            val publication = participant.getTrackPublication(Track.Source.CAMERA)
            return publication?.takeUnless { it.muted }?.track as? VideoTrack
        }
        val remote = media?.remoteParticipants?.values?.map { participant ->
            val id = participant.identity?.value ?: participant.sid.value
            ParticipantTile(id, Calls.displayNames[id] ?: participant.name?.takeIf { it.isNotBlank() } ?: id.substringAfter('|'), video(participant))
        }.orEmpty()
        val local = media?.localParticipant?.let { ParticipantTile(it.identity?.value ?: "local", "You", if (Calls.video) video(it) else null, true) }
        val participants = remote + listOfNotNull(local)
        val primary = participants.firstOrNull { it.id == primaryId } ?: remote.firstOrNull()
        primaryId = primary?.id
        val nextRender = listOf(call.callId, Calls.title, Calls.state, Calls.error, Calls.muted, Calls.video, Calls.audioRoute,
            isInPictureInPictureMode, participants, primaryId, theme, layout.width, layout.height, layout.paddingBottom)
        if (rendered == nextRender) return
        rendered = nextRender
        stripScroll = participantStrip?.scrollX ?: stripScroll
        participantStrip = null
        detach(); layout.removeAllViews()
        layout.setBackgroundColor(if (isInPictureInPictureMode) theme!!.tile else theme!!.scrim)
        if (isInPictureInPictureMode) {
            layout.addView(tile(primary ?: local, true), FrameLayout.LayoutParams(-1, -1))
            return
        }
        layout.setOnClickListener { dismissDrawer() }
        val drawer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; background = background(theme!!.drawer, 24)
            setPadding(dp(16), dp(10), dp(16), dp(16)); isClickable = true
            tag = "call-drawer"
        }
        val available = layout.height - layout.paddingTop - layout.paddingBottom
        layout.addView(drawer, FrameLayout.LayoutParams(-1, (available * 0.92f).toInt().coerceAtLeast(1), Gravity.BOTTOM))
        val handleArea = FrameLayout(this).apply {
            addView(View(this@CallActivity).apply { background = background(theme!!.edge, 3) },
                FrameLayout.LayoutParams(dp(36), dp(4), Gravity.CENTER))
            tag = "call-drawer-handle"
            contentDescription = "Dismiss call drawer"; isClickable = true; setOnClickListener { dismissDrawer() }
            setOnTouchListener { _, event ->
                when (event.actionMasked) {
                    MotionEvent.ACTION_DOWN -> { swipeY = event.rawY; true }
                    MotionEvent.ACTION_UP -> { if (event.rawY - swipeY > dp(40)) dismissDrawer() else performClick(); true }
                    else -> true
                }
            }
        }
        drawer.addView(handleArea, LinearLayout.LayoutParams(-1, dp(24)))
        val header = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        header.addView(label(Calls.title ?: call.title, 18f), LinearLayout.LayoutParams(0, dp(48), 1f))
        header.addView(actionButton(if (media == null) "Decline" else "Leave", theme!!.failure) { Calls.end(this, call.callId) }, LinearLayout.LayoutParams(-2, dp(48)))
        drawer.addView(header, LinearLayout.LayoutParams(-1, dp(56)))
        if (Calls.error != null) drawer.addView(label(Calls.error!!, 12f, theme!!.muted).apply { maxLines = 2 }, LinearLayout.LayoutParams(-1, -2))
        drawer.addView(tile(primary, true), LinearLayout.LayoutParams(-1, 0, 1f).apply { topMargin = dp(8) })
        val strip = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; tag = "call-participant-strip" }
        val stripContent = LinearLayout(this)
        participants.filter { it.id != primary?.id }.forEach { participant ->
            stripContent.addView(tile(participant, false), LinearLayout.LayoutParams(dp(112), -1).apply { rightMargin = dp(10) })
        }
        strip.addView(stripContent, FrameLayout.LayoutParams(-2, -1))
        participantStrip = strip
        drawer.addView(strip, LinearLayout.LayoutParams(-1, (available * 0.14f).toInt().coerceIn(dp(56), dp(96))).apply { topMargin = dp(12); bottomMargin = dp(16) })
        strip.post { if (participantStrip === strip) strip.scrollTo(stripScroll, 0) }
        val controls = LinearLayout(this).apply { gravity = Gravity.CENTER; tag = "call-controls" }
        if (media == null) controls.addView(actionButton("Answer", theme!!.success) {
            permission(Manifest.permission.RECORD_AUDIO, call.callId) { Calls.answer(this, call.callId) }
        }, LinearLayout.LayoutParams(dp(160), dp(52)))
        else {
            fun control(button: ImageButton, name: String) {
                val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER }
                column.addView(button, LinearLayout.LayoutParams(dp(56), dp(52)))
                column.addView(label(name, 11f, theme!!.muted).apply { gravity = Gravity.START or Gravity.CENTER_VERTICAL }, LinearLayout.LayoutParams(dp(56), dp(24)))
                controls.addView(column, LinearLayout.LayoutParams(dp(88), -2))
            }
            val speaker = icon("speaker", "Speaker mode", Calls.audioRoute == "Speakerphone") {
                Calls.route(if (Calls.audioRoute == "Speakerphone") CallAudioState.ROUTE_EARPIECE else CallAudioState.ROUTE_SPEAKER)
            }
            speaker.setOnLongClickListener { audioRoutes(); true }
            control(speaker, "Speaker")
            control(icon("mic", if (Calls.muted) "Unmute" else "Mute", Calls.muted, Calls.muted) {
                Calls.scope.launch { runCatching { Calls.microphone(Calls.muted) }.onSuccess { Calls.error = null; render() }.onFailure { Calls.error = "Could not change microphone"; render() } }
            }, if (Calls.muted) "Unmute" else "Mute")
            control(icon("video", if (Calls.video) "Video off" else "Video on", Calls.video, !Calls.video) {
                permission(Manifest.permission.CAMERA) { Calls.scope.launch { runCatching { Calls.camera(this@CallActivity, !Calls.video) }.onSuccess { Calls.error = null; render() }.onFailure { Calls.error = "Could not change camera"; render() } } }
            }, "Video")
        }
        drawer.addView(controls, LinearLayout.LayoutParams(-1, -2))
    }
    private fun audioRoutes() {
        val routes = listOf("Earpiece" to CallAudioState.ROUTE_EARPIECE, "Speaker" to CallAudioState.ROUTE_SPEAKER,
            "Headset" to CallAudioState.ROUTE_WIRED_HEADSET, "Bluetooth" to CallAudioState.ROUTE_BLUETOOTH)
        android.app.AlertDialog.Builder(this).setTitle("Audio output").setItems(routes.map { it.first }.toTypedArray()) { _, index ->
            val route = routes[index].second
            if (route == CallAudioState.ROUTE_BLUETOOTH && Build.VERSION.SDK_INT >= 31) permission(Manifest.permission.BLUETOOTH_CONNECT) { Calls.route(route) }
            else Calls.route(route)
        }.show()
    }
    private fun dismissDrawer() {
        if (!pip()) {
            packageManager.getLaunchIntentForPackage(packageName)?.let { startActivity(it) }
            finish()
        }
    }
    @Deprecated("Deprecated in Android") override fun onBackPressed() { dismissDrawer() }
    private fun pip(): Boolean {
        if (Calls.room == null || !packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) return false
        pipRequested = true
        return runCatching { enterPictureInPictureMode(PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9)).build()) }
            .getOrDefault(false).also { if (!it) pipRequested = false }
    }
    override fun onUserLeaveHint() { pip() }
    override fun onPictureInPictureModeChanged(inPip: Boolean, config: android.content.res.Configuration) {
        super.onPictureInPictureModeChanged(inPip, config); pipRequested = inPip; render()
    }
    override fun onStop() {
        super.onStop()
        // Back/swipe transitions can stop before the PiP mode callback arrives.
        // Closing PiP still releases capture through finish/onDestroy.
        if (isFinishing || (!pipRequested && !isInPictureInPictureMode)) stopCameraIfOwned()
    }
    private fun stopCameraIfOwned() {
        if (isChangingConfigurations || Calls.changed !== callback || !Calls.video) return
        val media = Calls.room ?: return
        Calls.scope.launch {
            if (Calls.room === media) runCatching { Calls.camera(this@CallActivity, false, media) }
        }
    }
    override fun onDestroy() {
        if (Build.VERSION.SDK_INT >= 33) backCallback?.let { onBackInvokedDispatcher.unregisterOnBackInvokedCallback(it) }
        backCallback = null
        permissionCallId?.let { Calls.finishMicrophonePermission(it) }
        permissionCallId = null; permissionAction = null
        stopCameraIfOwned()
        if (Calls.changed === callback) Calls.changed = null
        detach(); super.onDestroy()
    }
}
