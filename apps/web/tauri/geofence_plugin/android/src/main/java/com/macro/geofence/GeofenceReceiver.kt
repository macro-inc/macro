package com.macro.geofence

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofenceStatusCodes
import com.google.android.gms.location.GeofencingEvent
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Receives crossings from Google Play services, usually with no activity or
 * WebView running, and posts each one to the report endpoint under
 * [goAsync]. Fire-and-forget: a lost report only means that crossing does not
 * start its routine.
 */
class GeofenceReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val event = GeofencingEvent.fromIntent(intent) ?: return
        if (event.hasError()) {
            Log.w(TAG, "Geofence event error ${GeofenceStatusCodes.getStatusCodeString(event.errorCode)}")
            return
        }

        val transition = when (event.geofenceTransition) {
            Geofence.GEOFENCE_TRANSITION_ENTER -> FenceTransition.ARRIVE
            Geofence.GEOFENCE_TRANSITION_EXIT -> FenceTransition.LEAVE
            else -> return
        }
        val fenceIds = event.triggeringGeofences?.map { it.requestId } ?: return

        val appContext = context.applicationContext
        val pending = goAsync()
        GeofenceRegistrar.work.execute {
            try {
                for (fenceId in fenceIds) report(appContext, fenceId, transition)
            } finally {
                pending.finish()
            }
        }
    }

    private fun report(context: Context, fenceId: String, transition: FenceTransition) {
        val device = GeofenceStore.device(context) ?: return
        val fence = GeofenceStore.fences(context).firstOrNull { it.id == fenceId } ?: return
        if (fence.on != transition) return

        val status = post(device, fenceId, transition) ?: return
        Log.i(TAG, "Report answered fence=$fenceId httpStatus=$status")
        // A sign-out or a new device may have replaced the credentials while
        // the report was in flight; its answer then no longer applies.
        if (GeofenceStore.device(context) != device) return

        when (status) {
            HttpURLConnection.HTTP_UNAUTHORIZED -> {
                GeofenceStore.clear(context)
                GeofenceRegistrar.apply(context)
            }
            HttpURLConnection.HTTP_NOT_FOUND -> {
                GeofenceStore.removeFence(context, fenceId)
                GeofenceRegistrar.apply(context)
            }
        }
    }

    /** Returns the HTTP status, or null when the request never got an answer. */
    private fun post(device: GeofenceDevice, fenceId: String, transition: FenceTransition): Int? {
        val body = JSONObject().put("fence", fenceId).put("on", transition.wire).toString().toByteArray()
        val connection = try {
            URL(device.reportUrl).openConnection() as HttpURLConnection
        } catch (error: IOException) {
            Log.e(TAG, "Report failed fence=$fenceId", error)
            return null
        }

        return try {
            connection.requestMethod = "POST"
            // goAsync allows about ten seconds before the receiver is killed.
            connection.connectTimeout = 4_000
            connection.readTimeout = 4_000
            connection.doOutput = true
            connection.setFixedLengthStreamingMode(body.size)
            connection.setRequestProperty("Authorization", "Bearer ${device.token}")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body) }
            connection.responseCode
        } catch (error: IOException) {
            Log.e(TAG, "Report failed fence=$fenceId", error)
            null
        } finally {
            connection.disconnect()
        }
    }
}

/** Geofences do not survive a reboot or an app update; restore the stored ones. */
class GeofenceRestoreReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> {
                val pending = goAsync()
                GeofenceRegistrar.applyAsync(context) { pending.finish() }
            }
        }
    }
}
