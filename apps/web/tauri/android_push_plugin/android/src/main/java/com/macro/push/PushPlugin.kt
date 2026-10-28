package com.macro.push

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging

@InvokeArg
internal class ConfigureArgs { var recipientId: String? = null }
@InvokeArg
internal class WatchArgs { lateinit var channel: Channel }
@InvokeArg
internal class AcknowledgeArgs { lateinit var deliveryId: String }

@TauriPlugin(permissions = [Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications")])
class PushPlugin(private val activity: Activity) : Plugin(activity) {
    private companion object { const val TAG = "MacroPush" }

    override fun load(webView: WebView) {
        PushStore.createChannel(activity)
        PushStore.tap(activity, activity.intent)
    }

    override fun onNewIntent(intent: Intent) { PushStore.tap(activity, intent) }
    override fun onResume(activity: AppCompatActivity) {
        PushStore.foreground = true
        PushStore.emit("RESUME")
    }
    override fun onPause(activity: AppCompatActivity) { PushStore.foreground = false }
    override fun onDestroy(activity: AppCompatActivity) { PushStore.unwatch() }

    @Command
    override fun checkPermissions(invoke: Invoke) {
        PushStore.createChannel(activity)
        val asked = PushStore.prefs(activity).getBoolean("asked", false)
        val status = when {
            PushStore.canDisplay(activity) -> "granted"
            Build.VERSION.SDK_INT >= 33 && !asked &&
                ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED -> "prompt"
            else -> "denied"
        }
        invoke.resolve(JSObject().apply { put("status", status) })
    }

    @Command
    override fun requestPermissions(invoke: Invoke) {
        if (Build.VERSION.SDK_INT < 33 || PushStore.canDisplay(activity)) {
            checkPermissions(invoke)
            return
        }
        PushStore.prefs(activity).edit().putBoolean("asked", true).apply()
        requestPermissionForAlias("notifications", invoke, "permissionResult")
    }

    @PermissionCallback
    fun permissionResult(invoke: Invoke) { checkPermissions(invoke) }

    @Command
    fun register(invoke: Invoke) {
        if (FirebaseApp.initializeApp(activity) == null) {
            invoke.resolve(JSObject().apply { put("success", false); put("error", "Firebase is not configured") })
            return
        }
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (!task.isSuccessful) Log.w(TAG, "FCM token request failed", task.exception)
            invoke.resolve(JSObject().apply {
                put("success", task.isSuccessful)
                if (task.isSuccessful) put("token", task.result)
                else put("error", task.exception?.message ?: "Could not register for push notifications")
            })
        }
    }

    @Command
    fun configure(invoke: Invoke) {
        val args = invoke.parseArgs(ConfigureArgs::class.java)
        PushStore.configure(activity, args.recipientId?.takeIf { it.isNotBlank() })
        invoke.resolve()
    }

    @Command
    fun watch(invoke: Invoke) {
        PushStore.watch(activity, invoke.parseArgs(WatchArgs::class.java).channel)
        invoke.resolve()
    }

    @Command
    fun unwatch(invoke: Invoke) { PushStore.unwatch(); invoke.resolve() }

    @Command
    fun acknowledge(invoke: Invoke) {
        PushStore.acknowledge(activity, invoke.parseArgs(AcknowledgeArgs::class.java).deliveryId)
        invoke.resolve()
    }
}
