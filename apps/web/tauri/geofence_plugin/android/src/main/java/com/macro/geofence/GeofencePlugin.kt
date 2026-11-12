package com.macro.geofence

import android.Manifest
import android.app.Activity
import android.net.Uri
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject

@InvokeArg
internal class SetDeviceArgs {
    lateinit var deviceId: String
    lateinit var token: String
    lateinit var reportUrl: String
}

@InvokeArg
internal class FenceArgs {
    lateinit var id: String
    var latitude: Double = 0.0
    var longitude: Double = 0.0
    var radiusMeters: Double = 0.0
    lateinit var on: String
}

@InvokeArg
internal class SyncArgs {
    lateinit var fences: Array<FenceArgs>
}

private const val FOREGROUND = "location"
private const val BACKGROUND = "background"

/**
 * JS bridge for `plugin:geofence|<command>`. Monitoring and reporting live in
 * [GeofenceRegistrar] and [GeofenceReceiver], which run without the WebView.
 */
@TauriPlugin(
    permissions = [
        Permission(
            strings = [Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION],
            alias = FOREGROUND,
        ),
        Permission(strings = [Manifest.permission.ACCESS_BACKGROUND_LOCATION], alias = BACKGROUND),
    ]
)
class GeofencePlugin(private val activity: Activity) : Plugin(activity) {
    /** Whether fences were last registered with the permissions monitoring needs. */
    private var registeredWithPermission: Boolean? = null

    override fun load(webView: WebView) = register()

    /** Permission can change in Settings while the app is in the background. */
    override fun onResume(activity: AppCompatActivity) {
        if (registeredWithPermission != GeofenceRegistrar.canMonitor(activity)) register()
    }

    @Command
    fun status(invoke: Invoke) {
        invoke.resolve(JSObject().apply {
            put("permission", permission())
            put("device", GeofenceStore.device(activity) != null)
        })
    }

    @Command
    fun requestPermission(invoke: Invoke) {
        when {
            !GeofenceRegistrar.isSupported(activity) -> resolvePermission(invoke)
            !GeofenceRegistrar.hasForegroundPermission(activity) ->
                requestPermissionForAlias(FOREGROUND, invoke, "foregroundPermissionResult")
            !GeofenceRegistrar.hasBackgroundPermission(activity) ->
                requestPermissionForAlias(BACKGROUND, invoke, "backgroundPermissionResult")
            else -> resolvePermission(invoke)
        }
    }

    /** Android 11+ ignores background location asked together with foreground location. */
    @PermissionCallback
    fun foregroundPermissionResult(invoke: Invoke) {
        if (GeofenceRegistrar.hasForegroundPermission(activity) && !GeofenceRegistrar.hasBackgroundPermission(activity)) {
            requestPermissionForAlias(BACKGROUND, invoke, "backgroundPermissionResult")
        } else {
            resolvePermission(invoke)
        }
    }

    @PermissionCallback
    fun backgroundPermissionResult(invoke: Invoke) = resolvePermission(invoke)

    @Command
    fun setDevice(invoke: Invoke) {
        val args = invoke.parseArgs(SetDeviceArgs::class.java)
        val reportUrl = Uri.parse(args.reportUrl)
        if ((reportUrl.scheme != "https" && reportUrl.scheme != "http") || reportUrl.host.isNullOrEmpty()) {
            invoke.reject("reportUrl must be an absolute http(s) URL")
            return
        }

        GeofenceStore.setDevice(activity, GeofenceDevice(args.deviceId, args.token, args.reportUrl))
        register { invoke.resolve() }
    }

    @Command
    fun deviceId(invoke: Invoke) {
        val deviceId: Any = GeofenceStore.device(activity)?.deviceId ?: JSONObject.NULL
        invoke.resolve(JSObject().apply { put("deviceId", deviceId) })
    }

    @Command
    fun sync(invoke: Invoke) {
        val fences = invoke.parseArgs(SyncArgs::class.java).fences.map { args ->
            val on = FenceTransition.parse(args.on)
            if (on == null) {
                invoke.reject("Unknown fence transition ${args.on}")
                return
            }
            Fence(args.id, args.latitude, args.longitude, args.radiusMeters, on)
        }

        GeofenceStore.setFences(activity, fences)
        register { invoke.resolve() }
    }

    @Command
    fun clear(invoke: Invoke) {
        GeofenceStore.clear(activity)
        register { invoke.resolve() }
    }

    private fun register(then: () -> Unit = {}) {
        registeredWithPermission = GeofenceRegistrar.canMonitor(activity)
        GeofenceRegistrar.applyAsync(activity, then)
    }

    private fun resolvePermission(invoke: Invoke) {
        register()
        invoke.resolve(JSObject().apply { put("permission", permission()) })
    }

    private fun permission(): String {
        if (!GeofenceRegistrar.isSupported(activity)) return "unsupported"

        if (!GeofenceRegistrar.hasForegroundPermission(activity)) {
            // Tauri remembers a "don't ask again" denial; until then Android can still prompt.
            return when (getPermissionState(FOREGROUND)) {
                PermissionState.DENIED -> "denied"
                PermissionState.GRANTED, PermissionState.PROMPT, PermissionState.PROMPT_WITH_RATIONALE, null ->
                    "not_determined"
            }
        }

        return if (GeofenceRegistrar.hasBackgroundPermission(activity)) "always" else "when_in_use"
    }
}
