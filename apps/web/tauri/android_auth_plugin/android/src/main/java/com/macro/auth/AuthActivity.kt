package com.macro.auth

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.browser.auth.AuthTabIntent

/** Owns the browser result across rotation, without persisting credentials. */
class AuthActivity : ComponentActivity() {
    private val launcher = AuthTabIntent.registerActivityResultLauncher(this) { result ->
        if (!isFinishing) {
            // Returning to our task can dismiss the fallback browser first.
            // Its cancellation must not win over an already validated redirect.
            val received = AuthSession.pending
                ?.takeIf { it.callbackUrl == intent.getStringExtra("callbackUrl") }
                ?.receivedCallback
            val callback = result.resultUri
            if (received != null) {
                complete(received)
            } else if (result.resultCode == AuthTabIntent.RESULT_OK && callback != null) {
                // The browser has closed, so a mismatch is final rather than a stray intent.
                if (!complete(callback.toString())) {
                    fail("Authentication callback did not match this session")
                }
            } else {
                fail(if (result.resultCode == AuthTabIntent.RESULT_CANCELED) {
                    "User canceled login"
                } else {
                    "Authentication browser failed"
                })
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // A stale browser callback can recreate this activity after process death.
        // Never redeem it without the original in-memory invocation.
        val expected = intent.getStringExtra("callbackUrl")
        val session = AuthSession.pending?.takeIf { it.callbackUrl == expected }
        if (session == null) {
            fail("Authentication session expired. Please try again.")
            return
        }
        session.receivedCallback?.let {
            complete(it)
            return
        }
        if (savedInstanceState == null) {
            try {
                AuthTabIntent.Builder().build().launch(launcher, Uri.parse(session.authUrl), "macro")
            } catch (_: Exception) {
                fail("No authentication browser available")
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // Retain the original intent, which carries the expected nonce. A stray
        // redirect that does not match is ignored while the browser stays open.
        intent.data?.let { complete(it.toString()) }
    }

    /** Settles this activity for a callback that belongs to its session; false otherwise. */
    private fun complete(callback: String): Boolean {
        if (isFinishing) return true
        val expected = intent.getStringExtra("callbackUrl") ?: return false
        if (!AuthCallback.matches(expected, callback)) return false
        try {
            val params = AuthCallback.parameters(callback)
            if (params.containsKey("error")) {
                fail("Authentication was not completed")
                return true
            }
            val result = Intent()
            params["token"]?.let { result.putExtra("token", it) }
            setResult(Activity.RESULT_OK, result)
            finish()
        } catch (_: Exception) {
            fail("Invalid authentication callback")
        }
        return true
    }

    override fun onDestroy() {
        if (isFinishing) {
            intent.getStringExtra("callbackUrl")?.let { AuthSession.clear(it) }
        }
        super.onDestroy()
    }

    private fun fail(message: String) {
        setResult(Activity.RESULT_CANCELED, Intent().putExtra("error", message))
        finish()
    }
}
