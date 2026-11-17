package com.macro.geofence

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.tasks.Tasks
import java.util.concurrent.ExecutionException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Registers the stored fences with Google Play services. All registration and
 * reporting runs on one background thread, so a sync, a reboot restore and a
 * 404 removal never interleave their remove-then-add steps.
 */
internal object GeofenceRegistrar {
    /** Play services allows 100 geofences per app. */
    private const val MAX_GEOFENCES = 100

    val work: ExecutorService = Executors.newSingleThreadExecutor()

    fun isSupported(context: Context): Boolean =
        GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS

    fun hasForegroundPermission(context: Context): Boolean = granted(context, Manifest.permission.ACCESS_FINE_LOCATION)

    /** Background location became a separate runtime permission in Android 10. */
    fun hasBackgroundPermission(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            granted(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION)

    fun canMonitor(context: Context): Boolean =
        isSupported(context) && hasForegroundPermission(context) && hasBackgroundPermission(context)

    /** Replaces the registered geofences with the stored ones, on [work]. */
    fun applyAsync(context: Context, then: () -> Unit = {}) {
        val appContext = context.applicationContext
        work.execute {
            try {
                apply(appContext)
            } finally {
                then()
            }
        }
    }

    /** Call on [work] only. */
    @SuppressLint("MissingPermission")
    fun apply(context: Context) {
        if (!isSupported(context)) return

        val client = LocationServices.getGeofencingClient(context)
        val fences = if (GeofenceStore.device(context) == null) emptyList() else GeofenceStore.fences(context)
        try {
            Tasks.await(client.removeGeofences(pendingIntent(context)))
            if (fences.isEmpty() || !canMonitor(context)) return

            val request = GeofencingRequest.Builder()
                // Report crossings only: registering while inside a fence must
                // not count as arriving.
                .setInitialTrigger(0)
                .addGeofences(fences.distinctBy { it.id }.take(MAX_GEOFENCES).map { geofence(it) })
                .build()
            Tasks.await(client.addGeofences(request, pendingIntent(context)))
            Log.i(TAG, "Registered ${fences.size} geofences")
        } catch (error: ExecutionException) {
            Log.e(TAG, "Geofence registration failed", error.cause ?: error)
        } catch (error: SecurityException) {
            Log.e(TAG, "Geofence registration lost its location permission", error)
        } catch (error: InterruptedException) {
            Thread.currentThread().interrupt()
        }
    }

    private fun geofence(fence: Fence): Geofence =
        Geofence.Builder()
            .setRequestId(fence.id)
            .setCircularRegion(fence.latitude, fence.longitude, fence.radiusMeters.toFloat())
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            .setTransitionTypes(
                when (fence.on) {
                    FenceTransition.ARRIVE -> Geofence.GEOFENCE_TRANSITION_ENTER
                    FenceTransition.LEAVE -> Geofence.GEOFENCE_TRANSITION_EXIT
                }
            )
            .build()

    private fun pendingIntent(context: Context): PendingIntent {
        val intent = Intent(context, GeofenceReceiver::class.java)
        // Play services adds the event to the intent, so it must be mutable.
        val mutable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or mutable)
    }

    private fun granted(context: Context, permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
}
