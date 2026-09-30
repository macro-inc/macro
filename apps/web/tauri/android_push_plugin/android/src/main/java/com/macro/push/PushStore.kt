package com.macro.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import app.tauri.plugin.Channel
import app.tauri.plugin.JSObject
import org.json.JSONObject
import java.util.UUID

/** Persisted display/tap state survives ordinary process death, independently of the WebView. */
internal object PushStore {
    const val CHANNEL_ID = "macro_activity"
    private const val TAP_EXTRA = "com.macro.push.TAP"
    private const val MAX_RECORDS = 128
    private var watcher: Channel? = null
    private var ready = false
    @Volatile var foreground = false
    private var generation = 0
    private val main = Handler(Looper.getMainLooper())

    fun prefs(context: Context): SharedPreferences = context.getSharedPreferences("macro_push", Context.MODE_PRIVATE)
    private fun records(context: Context): JSONObject =
        runCatching { JSONObject(prefs(context).getString("records", "{}")!!) }.getOrDefault(JSONObject())

    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Activity", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Messages, mentions, email and other Macro activity"
                }
            )
        }
    }

    fun canDisplay(context: Context): Boolean {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
            context.getSystemService(NotificationManager::class.java)
                .getNotificationChannel(CHANNEL_ID)?.importance != NotificationManager.IMPORTANCE_NONE
    }

    @Synchronized
    fun configure(context: Context, recipient: String?) {
        val preferences = prefs(context)
        if (recipient != preferences.getString("recipient", null) || recipient == null) {
            generation++
            val old = records(context)
            old.keys().forEach { NotificationManagerCompat.from(context).cancel(it, 0) }
            preferences.edit().remove("records").putString("recipient", recipient).apply()
        }
        ready = recipient != null
        flush(context)
    }

    @Synchronized
    fun watch(context: Context, channel: Channel) {
        watcher = channel
        flush(context)
    }

    @Synchronized
    fun unwatch() { watcher = null; ready = false }

    @Synchronized
    fun emit(type: String, payload: JSONObject = JSONObject(), deliveryId: String? = null) {
        val channel = watcher ?: return
        val expectedGeneration = generation
        main.post {
            synchronized(this) {
                if (watcher === channel && generation == expectedGeneration) {
                    channel.send(JSObject().apply {
                        put("type", type); put("payload", payload)
                        if (deliveryId != null) put("deliveryId", deliveryId)
                    })
                }
            }
        }
    }

    @Synchronized
    fun receive(context: Context, data: Map<String, String>, sentTime: Long) {
        val message = PushMessage.parse(data, prefs(context).getString("recipient", null)) ?: return
        val all = records(context)
        val previous = all.optJSONObject(message.identifier)
        // FCM may reorder high-priority alerts and normal-priority clears.
        if (previous != null && sentTime < previous.optLong("sentTime")) return
        val manager = NotificationManagerCompat.from(context)
        if (message.clear) {
            manager.cancel(message.identifier, 0)
            all.put(message.identifier, JSONObject().put("sentTime", sentTime))
            save(context, all)
            return
        }
        val payload = runCatching { JSONObject(message.payload) }.getOrNull() ?: return
        val notificationId = payload.optString("notificationId")
        if (runCatching { UUID.fromString(notificationId) }.isFailure) return
        if (previous?.optString("notificationId") == notificationId) return
        // On an equal sentTime the clear wins: an alert sent in the same
        // millisecond as its clear must not resurface after the clear landed.
        if (previous != null && sentTime == previous.optLong("sentTime") && !previous.has("notificationId")) return
        createChannel(context)
        if (!canDisplay(context)) return
        val tapToken = UUID.randomUUID().toString()
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
        launch.action = "com.macro.push.OPEN.$tapToken"
        launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        launch.putExtra(TAP_EXTRA, tapToken)
        val pending = PendingIntent.getActivity(context, 0, launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val record = JSONObject().put("sentTime", sentTime)
            .put("notificationId", notificationId).put("token", tapToken)
            .put("payload", payload).put("pendingTap", false)
        all.put(message.identifier, record)
        save(context, all)
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_macro_notification)
            .setContentTitle(message.title.ifBlank { "Macro" })
            .setContentText(message.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message.body))
            .setContentIntent(pending).setAutoCancel(true).setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPriority(NotificationCompat.PRIORITY_HIGH).build()
        try {
            manager.notify(message.identifier, 0, notification)
        } catch (_: SecurityException) {
            // Permission can be revoked between the check and notify().
            return
        }
        emit(if (foreground) "FOREGROUND_DELIVERY" else "BACKGROUND_DELIVERY", payload)
    }

    @Synchronized
    fun tap(context: Context, intent: Intent) {
        val token = intent.getStringExtra(TAP_EXTRA) ?: return
        intent.removeExtra(TAP_EXTRA)
        val all = records(context)
        val id = all.keys().asSequence().firstOrNull { all.optJSONObject(it)?.optString("token") == token } ?: return
        val record = all.getJSONObject(id)
        record.put("pendingTap", true)
        record.put("deliveryId", UUID.randomUUID().toString())
        record.put("tapType", if (foreground) "FOREGROUND_TAP" else "BACKGROUND_TAP")
        // A one-use local token prevents exported activity intents from injecting payloads.
        record.remove("token")
        save(context, all)
        NotificationManagerCompat.from(context).cancel(id, 0)
        flush(context)
    }

    private fun flush(context: Context) {
        if (!ready || watcher == null || prefs(context).getString("recipient", null) == null) return
        val all = records(context)
        all.keys().forEach { id ->
            val record = all.getJSONObject(id)
            if (record.optBoolean("pendingTap")) {
                emit(record.getString("tapType"), record.getJSONObject("payload"), record.getString("deliveryId"))
            }
        }
    }

    @Synchronized
    fun acknowledge(context: Context, deliveryId: String) {
        val all = records(context)
        all.keys().forEach { id ->
            val record = all.getJSONObject(id)
            if (record.optString("deliveryId") == deliveryId) {
                record.put("pendingTap", false)
                record.remove("deliveryId")
            }
        }
        save(context, all)
    }

    private fun save(context: Context, all: JSONObject) {
        while (all.length() > MAX_RECORDS) {
            val oldest = all.keys().asSequence().minByOrNull { all.getJSONObject(it).optLong("sentTime") } ?: break
            all.remove(oldest)
            NotificationManagerCompat.from(context).cancel(oldest, 0)
        }
        // apply() keeps the write off the caller's thread; tap() and configure()
        // run on the main thread. The framework flushes pending writes before
        // the process is stopped.
        prefs(context).edit().putString("records", all.toString()).apply()
    }
}
