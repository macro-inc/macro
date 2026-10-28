package com.macro.auth

import android.app.Activity
import android.app.ActivityManager
import android.content.Intent
import android.os.Bundle

/** Brings the pending auth activity forward when a browser lacks Auth Tab support. */
class AuthRedirectActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        intent.data?.let { callback ->
            val session = AuthSession.matching(callback.toString()) ?: return@let
            // The receiver may be in the browser's task. Return to the task that
            // owns the invocation, rather than creating an unrelated auth activity.
            val task = getSystemService(ActivityManager::class.java).appTasks
                .firstOrNull { it.taskInfo.id == session.taskId } ?: return@let
            AuthSession.receive(callback.toString()) ?: return@let
            task.startActivity(this, Intent(this, AuthActivity::class.java)
                .putExtra("callbackUrl", session.callbackUrl)
                .setData(callback)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP), null)
        }
        finish()
    }
}
