package com.macro.push

import org.junit.Assert.*
import org.junit.Test

class PushMessageTest {
    private val recipient = "macro|alice@example.com"
    private val alert = mapOf("type" to "notification", "recipientId" to recipient,
        "identifier" to "channel-id", "title" to "Alice", "body" to "Hello", "payload" to "{}")

    @Test fun acceptsAlertsOnlyForTheActiveAccount() {
        assertEquals("Hello", PushMessage.parse(alert, recipient)?.body)
        assertNull(PushMessage.parse(alert, null))
        assertNull(PushMessage.parse(alert, "macro|bob@example.com"))
        assertNull(PushMessage.parse(alert - "recipientId", recipient))
    }

    @Test fun acceptsSilentClearWithoutTitleOrBody() {
        val message = PushMessage.parse((alert - "title" - "body") + ("type" to "clear"), recipient)
        assertTrue(message!!.clear)
        assertEquals("channel-id", message.identifier)
    }

    @Test fun rejectsUnknownOrIncompleteMessages() {
        assertNull(PushMessage.parse(alert + ("type" to "unknown"), recipient))
        assertNull(PushMessage.parse(alert - "identifier", recipient))
        assertNull(PushMessage.parse(alert - "title" - "body", recipient))
    }
}
