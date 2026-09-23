package com.macro.auth

import android.app.Activity
import android.content.Intent
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.net.URI

@InvokeArg
class AuthenticateArgs {
    lateinit var authUrl: String
    lateinit var callbackUrl: String
}

@TauriPlugin
class AuthPlugin(private val activity: Activity) : Plugin(activity) {
    private var active = false

    @Command
    fun authenticate(invoke: Invoke) {
        if (active) {
            invoke.reject("An authentication session is already running")
            return
        }
        try {
            val args = invoke.parseArgs(AuthenticateArgs::class.java)
            val authUrl = URI(args.authUrl)
            require(authUrl.scheme == "https" && authUrl.host != null && authUrl.userInfo == null)
            require(AuthCallback.isExpectedUrl(args.callbackUrl))
            val intent = Intent(activity, AuthActivity::class.java)
                .putExtra("authUrl", args.authUrl)
                .putExtra("callbackUrl", args.callbackUrl)
            active = true
            startActivityForResult(invoke, intent, "authResult")
        } catch (_: Exception) {
            active = false
            invoke.reject("Unable to start authentication")
        }
    }

    @ActivityCallback
    fun authResult(invoke: Invoke, result: ActivityResult) {
        active = false
        val response = JSObject()
        val success = result.resultCode == Activity.RESULT_OK
        response.put("success", success)
        if (success) {
            result.data?.getStringExtra("token")?.let { response.put("token", it) }
        } else {
            response.put("error", result.data?.getStringExtra("error") ?: "User canceled login")
        }
        invoke.resolve(response)
    }
}
