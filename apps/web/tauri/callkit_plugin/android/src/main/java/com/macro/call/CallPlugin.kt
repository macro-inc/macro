package com.macro.call

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.*
import app.tauri.plugin.*
import kotlinx.coroutines.launch
import java.net.URI
import java.util.UUID

@InvokeArg
internal class WatchArgs { lateinit var channel: Channel }
@InvokeArg
internal class OutgoingArgs {
    lateinit var callId: String
    lateinit var channelId: String
    var channelTitle: String? = null
    lateinit var serverUrl: String
    lateinit var token: String
    var joinLease: String? = null
}
@InvokeArg
internal class PrepareJoinArgs { lateinit var channelId: String }
@InvokeArg
internal class AbortJoinArgs { lateinit var lease: String }
@InvokeArg
internal class EnabledArgs { var enabled = false }
@InvokeArg
internal class TitleArgs { var channelTitle: String? = null }
@InvokeArg
internal class NameArgs { lateinit var identity: String; var displayName: String? = null }
@InvokeArg
internal class ThemeArgs { var theme: Map<String, Map<String, Double>> = emptyMap() }
@InvokeArg
internal class ModeArgs { var mode = "hidden" }

@TauriPlugin(permissions = [Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone"), Permission(strings = [Manifest.permission.CAMERA], alias = "camera")])
class CallPlugin(private val activity: Activity) : Plugin(activity) {
    private var preparePermissionCallId: String? = null
    private fun finishPreparePermission() {
        preparePermissionCallId?.let { Calls.finishMicrophonePermission(it) }
        preparePermissionCallId = null
    }
    private fun watch(invoke: Invoke, key: String) { Calls.watch(key, invoke.parseArgs(WatchArgs::class.java).channel); invoke.resolve() }
    @Command fun watchCallAnswered(invoke: Invoke) { watch(invoke, "answered") }
    @Command fun watchCallEnded(invoke: Invoke) { watch(invoke, "ended") }
    @Command fun watchConnectionState(invoke: Invoke) { watch(invoke, "connection"); Calls.publish() }
    @Command fun watchParticipantIdentities(invoke: Invoke) { watch(invoke, "participants"); Calls.publish() }
    @Command fun watchDrawerOpened(invoke: Invoke) { watch(invoke, "drawer") }
    @Command fun getActiveCallState(invoke: Invoke) { invoke.resolve(JSObject().apply { put("state", Calls.snapshot() ?: org.json.JSONObject.NULL) }) }
    @Command fun getPendingAnsweredCall(invoke: Invoke) {
        val channel = Calls.pendingAnswered; Calls.pendingAnswered = null
        invoke.resolve(JSObject().apply { put("channelId", channel ?: org.json.JSONObject.NULL); put("nativeMedia", true) })
    }
    @Command fun prepareJoin(invoke: Invoke) {
        if (Build.VERSION.SDK_INT < 26) { invoke.reject("Native calls require Android 8 or newer"); return }
        try {
            val args = invoke.parseArgs(PrepareJoinArgs::class.java)
            require(args.channelId.isNotBlank())
            if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                preparePermissionCallId = Calls.offer?.takeIf { it.channelId == args.channelId && Calls.beginMicrophonePermission(it.callId) }?.callId
                requestPermissionForAlias("microphone", invoke, "prepareJoinPermission"); return
            }
            invoke.resolve(JSObject().apply { put("lease", Calls.prepareJoin(activity, args.channelId)) })
        } catch (_: Exception) { finishPreparePermission(); invoke.reject("Unable to prepare native call join") }
    }
    @PermissionCallback fun prepareJoinPermission(invoke: Invoke) {
        finishPreparePermission()
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) prepareJoin(invoke)
        else invoke.reject("Microphone permission is required for calls")
    }
    @Command fun abortJoin(invoke: Invoke) {
        Calls.abortJoin(activity, invoke.parseArgs(AbortJoinArgs::class.java).lease); invoke.resolve()
    }
    @Command fun startOutgoingCall(invoke: Invoke) {
        if (Build.VERSION.SDK_INT < 26) { invoke.reject("Native calls require Android 8 or newer"); return }
        try {
            val args = invoke.parseArgs(OutgoingArgs::class.java)
            if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                // Leased joins already requested permission before membership was created.
                // A revoked grant must fail immediately rather than wait under the deadline.
                if (args.joinLease != null) invoke.reject("Microphone permission is required for calls")
                else requestPermissionForAlias("microphone", invoke, "outgoingPermission")
                return
            }
            require(URI(args.serverUrl).let { it.scheme == "wss" && it.host != null && it.userInfo == null })
            require(args.channelId.isNotBlank() && args.token.isNotBlank())
            Calls.outgoing(activity, CallOffer(UUID.fromString(args.callId).toString(), args.channelId,
                args.channelTitle ?: "Macro call", args.serverUrl, args.token), args.joinLease)
            invoke.resolve()
        } catch (_: Exception) { invoke.reject("Unable to start native call") }
    }
    @PermissionCallback fun outgoingPermission(invoke: Invoke) {
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startOutgoingCall(invoke)
        else invoke.reject("Microphone permission is required for calls")
    }
    @Command fun endActiveCall(invoke: Invoke) { Calls.end(activity); invoke.resolve() }
    @Command fun setVideoEnabled(invoke: Invoke) {
        val enabled = invoke.parseArgs(EnabledArgs::class.java).enabled
        if (enabled && activity.checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("camera", invoke, "cameraPermission"); return
        }
        Calls.scope.launch {
            try { Calls.camera(activity, enabled); invoke.resolve() }
            catch (_: Exception) { invoke.reject("Unable to change camera") }
        }
    }
    @PermissionCallback fun cameraPermission(invoke: Invoke) {
        if (activity.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) setVideoEnabled(invoke)
        else invoke.reject("Camera permission is required for video")
    }
    @Command fun setVideoOverlayMode(invoke: Invoke) {
        val mode = invoke.parseArgs(ModeArgs::class.java).mode
        if (mode !in listOf("hidden", "expanded", "minimized")) { invoke.reject("Invalid call surface mode"); return }
        Calls.overlay = mode
        if (mode != "hidden" && Calls.offer != null) {
            activity.startActivity(Intent(activity, CallActivity::class.java))
            Calls.offer?.let { Calls.emit("drawer", JSObject().apply { put("channelId", it.channelId) }) }
        }
        Calls.publish(); invoke.resolve()
    }
    @Command fun switchCamera(invoke: Invoke) { Calls.switchCamera(); invoke.resolve() }
    @Command fun setCallDrawerTheme(invoke: Invoke) {
        try {
            val json = org.json.JSONObject(invoke.parseArgs(ThemeArgs::class.java).theme)
            Calls.drawerTheme = CallTheme.parse(json)
            activity.getSharedPreferences("macro_call_theme", android.content.Context.MODE_PRIVATE)
                .edit().putString("theme", json.toString()).apply()
            Calls.publish(); invoke.resolve()
        } catch (_: Exception) { invoke.reject("Invalid call drawer theme") }
    }
    @Command fun setCallDrawerChannelTitle(invoke: Invoke) {
        Calls.title = invoke.parseArgs(TitleArgs::class.java).channelTitle
        Calls.title?.let { Calls.connection?.setCallerDisplayName(it, android.telecom.TelecomManager.PRESENTATION_ALLOWED) }
        Calls.publish(); invoke.resolve()
    }
    @Command fun setParticipantDisplayName(invoke: Invoke) {
        val args = invoke.parseArgs(NameArgs::class.java)
        val name = args.displayName?.trim()?.takeIf { it.isNotEmpty() }
        if (name == null) Calls.displayNames.remove(args.identity) else Calls.displayNames[args.identity] = name
        Calls.publish(); invoke.resolve()
    }
    @Command fun getVoipToken(invoke: Invoke) { invoke.resolve(JSObject().apply { put("token", org.json.JSONObject.NULL) }) }
    override fun onDestroy(activity: AppCompatActivity) { finishPreparePermission(); Calls.abortPendingJoin(activity); Calls.unwatch() }
}
