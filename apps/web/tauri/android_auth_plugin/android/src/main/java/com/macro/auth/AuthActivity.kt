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
            val callback = result.resultUri
            if (result.resultCode == AuthTabIntent.RESULT_OK && callback != null) {
                complete(callback.toString())
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
        val authUrl = intent.getStringExtra("authUrl")
        if (expected == null || authUrl == null || !AuthCallback.isExpectedUrl(expected)) {
            fail("Authentication session expired. Please try again.")
            return
        }
        if (savedInstanceState == null) {
            try {
                AuthTabIntent.Builder().build().launch(launcher, Uri.parse(authUrl), "macro")
            } catch (_: Exception) {
                fail("No authentication browser available")
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // Retain the original intent, which carries the expected nonce.
        intent.data?.let { complete(it.toString()) }
    }

    private fun complete(callback: String) {
        val expected = intent.getStringExtra("callbackUrl") ?: return
        if (!AuthCallback.matches(expected, callback)) {
            fail("Authentication callback did not match this session")
            return
        }
        try {
            val params = AuthCallback.parameters(callback)
            if (params.containsKey("error")) {
                fail("Authentication was not completed")
                return
            }
            val result = Intent()
            params["token"]?.let { result.putExtra("token", it) }
            setResult(Activity.RESULT_OK, result)
            finish()
        } catch (_: Exception) {
            fail("Invalid authentication callback")
        }
    }

    private fun fail(message: String) {
        setResult(Activity.RESULT_CANCELED, Intent().putExtra("error", message))
        finish()
    }
}
