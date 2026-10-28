package com.macro.network

import android.app.Activity
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
internal class WatchStatusArgs { lateinit var channel: Channel }

@TauriPlugin
class NetworkStatusPlugin(private val activity: Activity) : Plugin(activity) {
    private val connectivity = activity.getSystemService(ConnectivityManager::class.java)
    private var channel: Channel? = null
    private var registered = false
    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = publish()
        override fun onLost(network: Network) = publish()
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) = publish()
    }

    override fun load(webView: WebView) {
        // API 24 default-network callbacks follow Wi-Fi/cellular handoffs.
        connectivity.registerDefaultNetworkCallback(callback)
        registered = true
    }

    @Command
    fun watchStatus(invoke: Invoke) {
        channel = invoke.parseArgs(WatchStatusArgs::class.java).channel
        publish()
        invoke.resolve()
    }

    override fun onResume(activity: AppCompatActivity) = publish()

    override fun onDestroy(activity: AppCompatActivity) {
        if (registered) connectivity.unregisterNetworkCallback(callback)
        registered = false
        channel = null
    }

    private fun publish() {
        // Serialize callback and lifecycle delivery on the WebView thread.
        activity.runOnUiThread {
            val capabilities = connectivity.getNetworkCapabilities(connectivity.activeNetwork)
            val online = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true &&
                capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            channel?.send(JSObject().apply { put("status", if (online) "online" else "offline") })
        }
    }
}
