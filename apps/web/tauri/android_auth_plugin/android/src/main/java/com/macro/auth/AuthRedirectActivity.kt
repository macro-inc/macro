package com.macro.auth

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/** Brings the pending auth activity forward when a browser lacks Auth Tab support. */
class AuthRedirectActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        intent.data?.let { callback ->
            startActivity(Intent(this, AuthActivity::class.java)
                .setData(callback)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
        }
        finish()
    }
}
