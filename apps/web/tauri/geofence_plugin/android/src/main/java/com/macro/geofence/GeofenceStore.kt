package com.macro.geofence

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

internal const val TAG = "MacroGeofence"

/** The crossing a fence reports, as the scheduled-action service names it. */
internal enum class FenceTransition(val wire: String) {
    ARRIVE("arrive"),
    LEAVE("leave");

    companion object {
        fun parse(wire: String): FenceTransition? = entries.firstOrNull { it.wire == wire }
    }
}

/** One place a routine names, as the web app passes it to `sync`. */
internal data class Fence(
    val id: String,
    val latitude: Double,
    val longitude: Double,
    val radiusMeters: Double,
    val on: FenceTransition,
)

/** Device credentials minted by `POST /scheduled-actions/location/devices`. */
internal data class GeofenceDevice(val deviceId: String, val token: String, val reportUrl: String)

/**
 * Persists the device and its fences outside the WebView, so a crossing can be
 * reported, and fences restored after a reboot, without loading the web app.
 * Plain private preferences: the app disables backup and device transfer, and
 * the token only reports crossings for this device.
 */
internal object GeofenceStore {
    private const val DEVICE_ID = "deviceId"
    private const val TOKEN = "token"
    private const val REPORT_URL = "reportUrl"
    private const val FENCES = "fences"

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences("macro_geofence", Context.MODE_PRIVATE)

    @Synchronized
    fun device(context: Context): GeofenceDevice? {
        val prefs = prefs(context)
        val deviceId = prefs.getString(DEVICE_ID, null) ?: return null
        val token = prefs.getString(TOKEN, null) ?: return null
        val reportUrl = prefs.getString(REPORT_URL, null) ?: return null
        return GeofenceDevice(deviceId, token, reportUrl)
    }

    @Synchronized
    fun setDevice(context: Context, device: GeofenceDevice) {
        prefs(context).edit()
            .putString(DEVICE_ID, device.deviceId)
            .putString(TOKEN, device.token)
            .putString(REPORT_URL, device.reportUrl)
            .commit()
    }

    @Synchronized
    fun fences(context: Context): List<Fence> {
        val stored = prefs(context).getString(FENCES, null) ?: return emptyList()
        return try {
            val array = JSONArray(stored)
            (0 until array.length()).mapNotNull { index -> parseFence(array.getJSONObject(index)) }
        } catch (error: JSONException) {
            Log.e(TAG, "Dropping unreadable stored fences", error)
            prefs(context).edit().remove(FENCES).commit()
            emptyList()
        }
    }

    @Synchronized
    fun setFences(context: Context, fences: List<Fence>) {
        val array = JSONArray()
        for (fence in fences) {
            array.put(
                JSONObject()
                    .put("id", fence.id)
                    .put("latitude", fence.latitude)
                    .put("longitude", fence.longitude)
                    .put("radiusMeters", fence.radiusMeters)
                    .put("on", fence.on.wire)
            )
        }
        prefs(context).edit().putString(FENCES, array.toString()).commit()
    }

    @Synchronized
    fun removeFence(context: Context, id: String) {
        setFences(context, fences(context).filter { it.id != id })
    }

    /** Forgets the token, report URL and fences (sign-out or a revoked token). */
    @Synchronized
    fun clear(context: Context) {
        prefs(context).edit().clear().commit()
    }

    private fun parseFence(json: JSONObject): Fence? {
        val on = FenceTransition.parse(json.getString("on")) ?: return null
        return Fence(
            id = json.getString("id"),
            latitude = json.getDouble("latitude"),
            longitude = json.getDouble("longitude"),
            radiusMeters = json.getDouble("radiusMeters"),
            on = on,
        )
    }
}
