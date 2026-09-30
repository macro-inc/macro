package com.macro.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class PushService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        PushStore.receive(this, message.data, message.sentTime)
    }

    override fun onNewToken(token: String) {
        // Never log tokens. Foreground JS re-registers; cold starts always fetch
        // the current Firebase token, covering refresh while JS wasn't running.
        PushStore.emit("TOKEN_REFRESH")
    }
}
