package com.macro.call

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.telecom.*
import androidx.core.content.ContextCompat
import app.tauri.plugin.Channel
import app.tauri.plugin.JSObject
import com.twilio.audioswitch.AudioDevice
import io.livekit.android.LiveKit
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import io.livekit.android.room.participant.Participant
import io.livekit.android.room.participant.RemoteParticipant
import io.livekit.android.room.track.LocalVideoTrack
import io.livekit.android.room.track.RemoteAudioTrack
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.VideoTrack
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Main-thread owner shared by Telecom, FCM, service, Activity and the WebView. */
internal object Calls {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    var offer: CallOffer? = null
        private set
    var connection: Connection? = null
    var room: Room? = null
        private set
    var state = "disconnected"
        private set
    var muted = false
        private set
    var video = false
        private set
    var error: String? = null
    /** Where the call UI is, as on iOS: the drawer (expanded), the in-app thumbnail (minimized), or an edge tab (hidden). */
    var overlay = "hidden"
        private set
    var pendingAnswered: String? = null
    var changed: (() -> Unit)? = null
    var miniWindowChanged: (() -> Unit)? = null
    private var spotlightId: String? = null
    private var session: Job? = null
    private var poller: Job? = null
    private var held = false
    private var answering = false
    private var accepted = false
    private var microphonePermissionStartedAt: Long? = null
    private var microphonePermissionPausedMs = 0L
    private data class JoinLease(val id: String, val channelId: String, val recipient: String?, var callId: String? = null)
    private var joinLease: JoinLease? = null
    private var leaseTimeout: Job? = null
    private var focusLost = false
    private var telecomMuted = false
    private var telecomFocusLost = false
    private var desiredAudioType: String? = null
    private var remoteAudioSilenced = false
    private var publishedIdentities: String? = null
    private val audioMutex = Mutex()
    private val videoMutex = Mutex()
    var recipient: String? = null
        private set
    var drawerTheme: CallTheme? = null
    var audioRoute: String? = null
        private set
    var title: String? = null
    val displayNames = mutableMapOf<String, String>()
    private val watchers = mutableMapOf<String, Channel>()
    private val accountId = "macro_calls"

    private fun account(ctx: Context): PhoneAccountHandle {
        val handle = PhoneAccountHandle(ComponentName(ctx, TelecomService::class.java), accountId)
        ctx.getSystemService(TelecomManager::class.java).registerPhoneAccount(
            PhoneAccount.builder(handle, "Macro").setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED)
                .setSupportedUriSchemes(listOf("macro-call")).build()
        )
        return handle
    }
    fun watch(name: String, channel: Channel) { watchers[name] = channel; publishedIdentities = null }
    fun unwatch() { watchers.clear() }
    // Agents such as the transcriber join the room but are not call participants.
    fun remoteHumans(media: Room): List<RemoteParticipant> =
        media.remoteParticipants.values.filter { it.kind != Participant.Kind.AGENT }
    fun participantId(participant: Participant) = participant.identity?.value ?: participant.sid.value
    fun displayName(participant: Participant): String {
        val id = participantId(participant)
        return displayNames[id] ?: participant.name?.takeIf { it.isNotBlank() } ?: id.substringAfter('|')
    }
    // Same rule as the iOS call UI, so fallback identities don't render as "M" for "macro|...".
    fun initials(name: String) = name.split(' ', '@', '.', '|').filter { it.isNotBlank() && !it.equals("macro", true) }
        .take(2).joinToString("") { it.take(1).uppercase() }.ifEmpty { "?" }
    fun localName(media: Room) = displayNames[participantId(media.localParticipant)] ?: "You"
    fun cameraTrack(participant: Participant): VideoTrack? =
        participant.getTrackPublication(Track.Source.CAMERA)?.takeUnless { it.muted }?.track as? VideoTrack
    /** PiP and the mini-window show the active speaker, keeping the last one through pauses. */
    fun spotlight(media: Room): RemoteParticipant? {
        val humans = remoteHumans(media)
        val speaking = media.activeSpeakers.map(::participantId).firstNotNullOfOrNull { id -> humans.firstOrNull { participantId(it) == id } }
        return (speaking ?: humans.firstOrNull { participantId(it) == spotlightId } ?: humans.firstOrNull())
            .also { spotlightId = it?.let(::participantId) }
    }
    fun setOverlay(mode: String) {
        if (overlay == mode) return
        overlay = mode
        publish()
    }
    fun openDrawer(ctx: Context) {
        val call = offer ?: return
        setOverlay("expanded")
        ctx.startActivity(Intent(ctx, CallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        emit("drawer", JSObject().apply { put("channelId", call.channelId) })
    }
    /** Re-renders native call surfaces without notifying JS. */
    fun refresh() {
        changed?.invoke()
        miniWindowChanged?.invoke()
    }
    // Release builds obfuscate audioswitch class names, so match device types.
    private fun audioType(device: AudioDevice?): String? = when (device) {
        is AudioDevice.BluetoothHeadset -> "BluetoothHeadset"
        is AudioDevice.WiredHeadset -> "WiredHeadset"
        is AudioDevice.Earpiece -> "Earpiece"
        is AudioDevice.Speakerphone -> "Speakerphone"
        null -> null
    }
    fun emit(name: String, payload: JSObject) { watchers[name]?.send(payload) }
    fun snapshot(): JSObject? = offer?.takeIf { accepted }?.let {
        JSObject().apply {
            put("callId", it.callId); put("channelId", it.channelId); put("connectionState", state)
            put("isAudioMuted", muted || interrupted()); put("isVideoMuted", !video); put("videoOverlayMode", overlay)
            put("participantIdentities", identities())
        }
    }
    private fun identities(): JSONArray = JSONArray().apply {
        room?.localParticipant?.identity?.value?.let { put(it) }
        room?.let { remoteHumans(it).forEach { participant -> participant.identity?.value?.let { id -> put(id) } } }
    }
    private fun interrupted(): Boolean = held || focusLost || telecomFocusLost
    private fun syncRemoteAudio() {
        // setVolume blocks on LiveKit's RTC thread; only touch tracks while silencing or restoring.
        val silence = interrupted()
        if (!silence && !remoteAudioSilenced) return
        remoteAudioSilenced = silence
        room?.remoteParticipants?.values?.forEach { participant ->
            participant.trackPublications.values.forEach { publication ->
                (publication.track as? RemoteAudioTrack)?.setVolume(if (silence) 0.0 else 1.0)
            }
        }
    }
    fun publish() {
        syncRemoteAudio()
        val payload = snapshot() ?: JSObject()
        payload.put("state", if (accepted) state else "disconnected")
        emit("connection", payload)
        // JS re-sends every display name when identities arrive; repeating unchanged ones floods the bridge.
        val identities = identities()
        if (identities.toString() != publishedIdentities) {
            publishedIdentities = identities.toString()
            emit("participants", JSObject().apply { put("identities", identities) })
        }
        refresh()
    }
    fun prepareJoin(ctx: Context, channelId: String): String {
        check(joinLease == null) { "A call join is already pending" }
        val lease = JoinLease(java.util.UUID.randomUUID().toString(), channelId,
            ctx.getSharedPreferences("macro_push", Context.MODE_PRIVATE).getString("recipient", null),
            offer?.takeIf { !accepted && it.channelId == channelId }?.callId)
        joinLease = lease
        if (lease.callId != null) { poller?.cancel(); poller = null }
        leaseTimeout = scope.launch { delay(30_000); abortJoin(ctx, lease.id) }
        return lease.id
    }
    fun abortJoin(ctx: Context, id: String) {
        val lease = joinLease?.takeIf { it.id == id } ?: return
        joinLease = null; leaseTimeout?.cancel(); leaseTimeout = null
        if (!accepted && offer?.callId == lease.callId) end(ctx, lease.callId)
    }
    fun abortPendingJoin(ctx: Context) { joinLease?.let { abortJoin(ctx, it.id) } }
    fun resetRecipient(ctx: Context, previous: String?) {
        if (previous == null) return
        joinLease?.takeIf { it.recipient == previous }?.let { abortJoin(ctx, it.id) }
        if (recipient == previous) end(ctx)
    }
    // Pause local expiry only; remote ring status still resolves cancelled calls.
    private fun ringTime(): Long {
        val pending = microphonePermissionStartedAt?.let { SystemClock.elapsedRealtime() - it } ?: 0L
        return System.currentTimeMillis() - microphonePermissionPausedMs - pending
    }
    fun beginMicrophonePermission(id: String): Boolean {
        val next = offer ?: return false
        if (next.callId != id || accepted || !CallOffer.fresh(next.sentTime, ringTime())) return false
        if (microphonePermissionStartedAt == null) microphonePermissionStartedAt = SystemClock.elapsedRealtime()
        return true
    }
    fun finishMicrophonePermission(id: String) {
        if (offer?.callId != id) return
        microphonePermissionStartedAt?.let { microphonePermissionPausedMs += SystemClock.elapsedRealtime() - it }
        microphonePermissionStartedAt = null
    }
    fun receive(ctx: Context, data: Map<String, String>, sentTime: Long) {
        if (android.os.Build.VERSION.SDK_INT < 26) return
        val next = runCatching { CallOffer.parse(data["payload"].orEmpty(), sentTime) }.getOrNull()
        val now = System.currentTimeMillis()
        // Log only the reason: payloads carry LiveKit credentials.
        val ignored = when {
            data["recipientId"] != ctx.getSharedPreferences("macro_push", Context.MODE_PRIVATE).getString("recipient", null) -> "another account"
            next == null -> "invalid payload"
            !CallOffer.fresh(sentTime, now) -> "stale, sent ${now - sentTime}ms ago"
            ctx.getSharedPreferences("macro_calls", Context.MODE_PRIVATE).getLong(next.callId, 0) > now - 120_000 -> "call recently ended"
            offer != null -> "another call is ringing or active"
            else -> null
        }
        if (ignored != null || next == null) { android.util.Log.i("MacroCall", "Ignored call push: $ignored"); return }
        recipient = ctx.getSharedPreferences("macro_push", Context.MODE_PRIVATE).getString("recipient", null)
        title = next.title
        offer = next; state = "ringing"; accepted = false
        try {
            val handle = account(ctx)
            ctx.getSystemService(TelecomManager::class.java).addNewIncomingCall(handle, Bundle().apply { putString("callId", next.callId) })
            if (joinLease?.channelId == next.channelId) {
                joinLease?.callId = next.callId
                return
            }
            poller = scope.launch {
                while (offer === next && room == null) {
                    if (!CallOffer.fresh(next.sentTime, ringTime())) { end(ctx, next.callId); break }
                    val status = ringStatus(next)
                    if (offer !== next || joinLease?.channelId == next.channelId) break
                    if (RingPolicy.decide(next.sentTime, ringTime(), status) == RingPolicy.Decision.RESOLVE) { end(ctx, next.callId); break }
                    delay(1000)
                }
            }
        } catch (error: Exception) {
            android.util.Log.w("MacroCall", "Incoming call failed: ${error.javaClass.simpleName}")
            end(ctx, next.callId)
        }
    }
    private suspend fun ringStatus(next: CallOffer): String? = withContext(Dispatchers.IO) {
        runCatching {
            val http = URL(next.ringUrl ?: return@withContext null).openConnection() as HttpURLConnection
            try {
                http.instanceFollowRedirects = false
                http.connectTimeout = 5000; http.readTimeout = 5000
                http.setRequestProperty("Authorization", "Bearer ${next.token}")
                when (http.responseCode) {
                    200 -> JSONObject(http.inputStream.bufferedReader().use { it.readText() }).getString("status")
                    401, 403, 404 -> "invalid"
                    else -> null
                }
            } finally { http.disconnect() }
        }.getOrNull()
    }
    fun outgoing(ctx: Context, next: CallOffer, leaseId: String? = null) {
        if (leaseId != null) check(joinLease?.let { it.id == leaseId && it.channelId == next.channelId } == true) { "Call join was cancelled" }
        val current = offer
        if (current?.callId == next.callId) {
            if (accepted) { joinLease = null; leaseTimeout?.cancel(); leaseTimeout = null }
            if (!accepted) {
                poller?.cancel(); poller = null
                offer = next; title = next.title; accepted = true; state = "connecting"
                joinLease = null; leaseTimeout?.cancel(); leaseTimeout = null
                publish(); connect(ctx)
            }
            return
        }
        check(current == null) { "Another call is active" }
        recipient = ctx.getSharedPreferences("macro_push", Context.MODE_PRIVATE).getString("recipient", null)
        title = next.title
        joinLease = null; leaseTimeout?.cancel(); leaseTimeout = null
        offer = next; state = "connecting"; accepted = true; publish()
        try {
            val handle = account(ctx)
            ctx.getSystemService(TelecomManager::class.java).placeCall(Uri.parse("macro-call:${next.callId}"), Bundle().apply {
                putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, handle)
                putBundle(TelecomManager.EXTRA_OUTGOING_CALL_EXTRAS, Bundle().apply { putString("callId", next.callId) })
            })
        } catch (error: Exception) { end(ctx, next.callId); throw error }
    }
    fun showIncoming(ctx: Context) {
        try { CallService.start(ctx); publish() }
        catch (error: Exception) {
            // Background starts can be denied, e.g. when FCM delivered the push without high priority.
            android.util.Log.w("MacroCall", "Incoming call UI failed: ${error.javaClass.simpleName}")
            end(ctx)
        }
    }
    fun answer(ctx: Context, id: String, verify: suspend (CallOffer) -> String? = ::ringStatus) {
        val next = offer ?: return
        if (next.callId != id || room != null || answering) return
        answering = true
        scope.launch {
            // Recheck immediately before answer to close the answered-elsewhere race.
            val status = verify(next)
            if (offer !== next) return@launch
            answering = false
            if (joinLease?.channelId == next.channelId) return@launch
            if (room != null || accepted) return@launch
            when (RingPolicy.decide(next.sentTime, ringTime(), status)) {
                RingPolicy.Decision.RESOLVE -> { end(ctx, id); return@launch }
                RingPolicy.Decision.RETRY -> { error = "Could not verify this call. Check your connection and try again."; publish(); return@launch }
                RingPolicy.Decision.RING -> error = null
            }
            if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                if (!beginMicrophonePermission(id)) return@launch
                runCatching {
                    ctx.startActivity(Intent(ctx, CallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("answer", id))
                }.onFailure { finishMicrophonePermission(id) }
                return@launch
            }
            poller?.cancel(); poller = null
            accepted = true; state = "connecting"
            pendingAnswered = next.channelId
            connect(ctx)
            emit("answered", JSObject().apply { put("channelId", next.channelId); put("nativeMedia", true) })
        }
    }
    fun connect(ctx: Context) {
        val next = offer ?: return
        if (room != null) return
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) { end(ctx, next.callId); return }
        val media = LiveKit.create(ctx.applicationContext)
        room = media
        media.audioSwitchHandler?.loggingEnabled = false
        media.audioSwitchHandler?.registerAudioDeviceChangeListener { devices, selected ->
            scope.launch {
                if (room !== media) return@launch
                audioRoute = audioType(selected)
                publish()
                if (audioRoute != desiredAudioType) {
                    devices.firstOrNull { audioType(it) == desiredAudioType }?.let { media.audioSwitchHandler?.selectDevice(it) }
                }
            }
        }
        media.audioSwitchHandler?.registerOnAudioFocusChangeListener(AudioManager.OnAudioFocusChangeListener { focus ->
            scope.launch {
                if (room !== media) return@launch
                focusLost = focus != AudioManager.AUDIOFOCUS_GAIN
                if (state == "connected" || state == "reconnecting") runCatching { applyMicrophone() }
                publish()
            }
        })
        session = scope.launch {
            try {
                CallService.start(ctx, media = true)
                launch {
                    media.events.collect { event ->
                        if (room !== media) return@collect
                        when (event) {
                            is RoomEvent.Reconnecting -> state = "reconnecting"
                            is RoomEvent.Reconnected -> state = "connected"
                            is RoomEvent.Disconnected -> { end(ctx, next.callId); return@collect }
                            else -> {}
                        }
                        publish()
                    }
                }
                media.connect(next.serverUrl, next.token)
                if (room !== media) return@launch
                media.localParticipant.setMicrophoneEnabled(!muted && !interrupted())
                state = "connected"; connection?.setActive(); overlay = "expanded"; publish()
                ctx.startActivity(Intent(ctx, CallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (_: CancellationException) {
                // end() already owns teardown.
            } catch (error: Exception) {
                // Exception messages can contain the signaling URL/token; log types only.
                android.util.Log.w("MacroCall", "Native media failed: ${error.javaClass.simpleName}; cause=${error.cause?.javaClass?.simpleName}")
                if (offer === next) {
                    android.widget.Toast.makeText(ctx, "Could not connect the call. Please try again.", android.widget.Toast.LENGTH_LONG).show()
                    end(ctx, next.callId)
                }
            }
        }
    }
    suspend fun microphone(enabled: Boolean) = audioMutex.withLock {
        val media = room ?: return@withLock
        media.localParticipant.setMicrophoneEnabled(enabled && !interrupted())
        if (room === media) { muted = !enabled; publish() }
    }
    private suspend fun applyMicrophone() = audioMutex.withLock {
        val media = room ?: return@withLock
        media.localParticipant.setMicrophoneEnabled(!muted && !interrupted())
        if (room === media) publish()
    }
    fun hold(value: Boolean) {
        held = value
        scope.launch { runCatching { applyMicrophone() } }
    }
    suspend fun camera(ctx: Context, enabled: Boolean, expectedRoom: Room? = null) = videoMutex.withLock {
        val media = room ?: return@withLock
        if (expectedRoom != null && media !== expectedRoom) return@withLock
        if (enabled) {
            check(ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) { "Camera permission required" }
            CallService.start(ctx, media = true, camera = true)
        }
        media.localParticipant.setCameraEnabled(enabled)
        if (room === media) { video = enabled; CallService.start(ctx, media = true, camera = enabled); publish() }
    }
    /** Stops capture once no call surface (drawer, PiP or mini-window) is visible. */
    fun stopCamera(ctx: Context) {
        val media = room ?: return
        if (!video) return
        scope.launch { if (room === media) runCatching { camera(ctx, false, media) } }
    }
    fun switchCamera() { (room?.localParticipant?.getTrackPublication(Track.Source.CAMERA)?.track as? LocalVideoTrack)?.switchCamera() }
    private fun selectAudio(type: String) {
        desiredAudioType = type
        val handler = room?.audioSwitchHandler ?: return
        handler.availableAudioDevices.firstOrNull { audioType(it) == type }?.let { handler.selectDevice(it) }
    }
    fun telecomAudio(audio: CallAudioState) {
        scope.launch {
            if (telecomMuted != audio.isMuted) {
                telecomMuted = audio.isMuted
                runCatching { microphone(!audio.isMuted) }
            }
            selectAudio(when (audio.route) {
                CallAudioState.ROUTE_BLUETOOTH -> "BluetoothHeadset"
                CallAudioState.ROUTE_WIRED_HEADSET -> "WiredHeadset"
                CallAudioState.ROUTE_SPEAKER -> "Speakerphone"
                else -> "Earpiece"
            })
        }
    }
    fun telecomFocus(gained: Boolean) {
        telecomFocusLost = !gained
        scope.launch { runCatching { applyMicrophone() }; publish() }
    }
    fun systemMute(value: Boolean) {
        telecomMuted = value
        scope.launch { runCatching { microphone(!value) } }
    }
    fun endpointAudio(type: Int) {
        selectAudio(when (type) {
            CallEndpoint.TYPE_BLUETOOTH -> "BluetoothHeadset"
            CallEndpoint.TYPE_WIRED_HEADSET -> "WiredHeadset"
            CallEndpoint.TYPE_SPEAKER -> "Speakerphone"
            else -> "Earpiece"
        })
    }
    fun route(route: Int) { (connection as? TelecomService.MacroConnection)?.route(route) }
    fun end(ctx: Context, id: String? = offer?.callId,
        disconnectConnection: (Connection) -> Unit = { it.setDisconnected(DisconnectCause(DisconnectCause.LOCAL)) }) {
        val next = offer ?: return
        if (next.callId != id) return
        val preferences = ctx.getSharedPreferences("macro_calls", Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        runCatching {
            preferences.edit().apply {
                preferences.all.forEach { (key, timestamp) -> if ((timestamp as? Long ?: 0) < now - 120_000) remove(key) }
                putLong(next.callId, now)
            }.apply()
        }
        if (joinLease?.callId == next.callId) {
            joinLease = null; leaseTimeout?.cancel(); leaseTimeout = null
        }
        microphonePermissionStartedAt = null; microphonePermissionPausedMs = 0L
        poller?.cancel(); poller = null
        session?.cancel(); session = null
        val media = room; room = null
        val telecomConnection = connection; connection = null
        offer = null; pendingAnswered = null; state = "disconnected"; title = null; recipient = null; displayNames.clear(); error = null; muted = false; video = false; held = false; answering = false; accepted = false; focusLost = false; telecomMuted = false; telecomFocusLost = false; desiredAudioType = null; remoteAudioSilenced = false; audioRoute = null; overlay = "hidden"; spotlightId = null
        // Native/SDK callbacks may fail or reenter; no resource owns the cleared session.
        // Release each resource independently so one failure cannot leave a phantom call.
        runCatching { media?.disconnect() }
        runCatching { media?.release() }
        runCatching { telecomConnection?.let(disconnectConnection) }
        runCatching { telecomConnection?.destroy() }
        runCatching { CallService.stop() }
        runCatching { ctx.getSystemService(android.app.NotificationManager::class.java).cancel(CallService.NOTIFICATION_ID) }
        runCatching { publish() }
        runCatching { emit("ended", JSObject().apply { put("callId", next.callId) }) }
    }
}
