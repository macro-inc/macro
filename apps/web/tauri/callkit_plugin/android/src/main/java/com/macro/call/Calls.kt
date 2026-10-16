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
import io.livekit.android.LiveKit
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import io.livekit.android.room.track.LocalVideoTrack
import io.livekit.android.room.track.RemoteAudioTrack
import io.livekit.android.room.track.Track
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
    var overlay = "hidden"
    var pendingAnswered: String? = null
    var changed: (() -> Unit)? = null
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
    fun watch(name: String, channel: Channel) { watchers[name] = channel }
    fun unwatch() { watchers.clear() }
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
        room?.remoteParticipants?.values?.forEach { it.identity?.value?.let { id -> put(id) } }
    }
    private fun interrupted(): Boolean = held || focusLost || telecomFocusLost
    private fun syncRemoteAudio() {
        room?.remoteParticipants?.values?.forEach { participant ->
            participant.trackPublications.values.forEach { publication ->
                (publication.track as? RemoteAudioTrack)?.setVolume(if (interrupted()) 0.0 else 1.0)
            }
        }
    }
    fun publish() {
        syncRemoteAudio()
        val payload = snapshot() ?: JSObject()
        payload.put("state", if (accepted) state else "disconnected")
        emit("connection", payload)
        emit("participants", JSObject().apply { put("identities", identities()) })
        changed?.invoke()
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
        if (data["recipientId"] != ctx.getSharedPreferences("macro_push", Context.MODE_PRIVATE).getString("recipient", null)) return
        val next = runCatching { CallOffer.parse(data["payload"] ?: return, sentTime) }.getOrNull() ?: return
        if (!CallOffer.fresh(sentTime, System.currentTimeMillis())) return
        if (ctx.getSharedPreferences("macro_calls", Context.MODE_PRIVATE).getLong(next.callId, 0) > System.currentTimeMillis() - 120_000) return
        if (offer != null) return
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
        } catch (_: Exception) { end(ctx, next.callId) }
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
        catch (_: Exception) { end(ctx) }
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
                audioRoute = selected?.javaClass?.simpleName
                publish()
                if (selected?.javaClass?.simpleName != desiredAudioType) {
                    devices.firstOrNull { it.javaClass.simpleName == desiredAudioType }?.let { media.audioSwitchHandler?.selectDevice(it) }
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
                state = "connected"; connection?.setActive(); publish()
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
    fun switchCamera() { (room?.localParticipant?.getTrackPublication(Track.Source.CAMERA)?.track as? LocalVideoTrack)?.switchCamera() }
    private fun selectAudio(type: String) {
        desiredAudioType = type
        val handler = room?.audioSwitchHandler ?: return
        handler.availableAudioDevices.firstOrNull { it.javaClass.simpleName == type }?.let { handler.selectDevice(it) }
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
        offer = null; pendingAnswered = null; state = "disconnected"; title = null; recipient = null; displayNames.clear(); error = null; muted = false; video = false; held = false; answering = false; accepted = false; focusLost = false; telecomMuted = false; telecomFocusLost = false; desiredAudioType = null; audioRoute = null; overlay = "hidden"
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
