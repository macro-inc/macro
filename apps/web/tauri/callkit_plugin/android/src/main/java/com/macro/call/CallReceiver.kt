package com.macro.call

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.launch

/** Explicit, unexported receiver: external apps cannot inject call credentials/actions. */
class CallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        Calls.scope.launch {
            try {
                when (intent.action) {
                    "com.macro.call.PUSH" -> {
                        val data = mapOf("recipientId" to (intent.getStringExtra("recipientId") ?: ""),
                            "payload" to (intent.getStringExtra("payload") ?: ""))
                        Calls.receive(context.applicationContext, data, intent.getLongExtra("sentTime", 0))
                    }
                    "com.macro.call.RESET" -> Calls.resetRecipient(context.applicationContext, intent.getStringExtra("previousRecipient"))
                    "answer" -> intent.getStringExtra("callId")?.let { Calls.answer(context.applicationContext, it) }
                    "end" -> intent.getStringExtra("callId")?.let { Calls.end(context.applicationContext, it) }
                }
            } finally { pending.finish() }
        }
    }
}
