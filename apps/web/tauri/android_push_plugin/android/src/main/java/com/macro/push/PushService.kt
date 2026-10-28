package com.macro.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class PushService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        if (message.data["type"] == "call") {
            // Explicit in-package broadcast keeps the FCM workstream independent
            // of the native call plugin and never hands credentials to the WebView.
            sendBroadcast(android.content.Intent("com.macro.call.PUSH")
                .setClassName(packageName, "com.macro.call.CallReceiver")
                .putExtra("recipientId", message.data["recipientId"])
                .putExtra("payload", message.data["payload"])
                .putExtra("sentTime", message.sentTime))
        } else PushStore.receive(this, message.data, message.sentTime)
    }

    override fun onNewToken(token: String) {
        // Never log tokens. Foreground JS re-registers; cold starts always fetch
        // the current Firebase token, covering refresh while JS wasn't running.
        PushStore.emit("TOKEN_REFRESH")
    }
}
