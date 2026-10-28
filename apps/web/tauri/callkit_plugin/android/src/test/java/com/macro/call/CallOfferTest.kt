package com.macro.call

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class CallOfferTest {
    private fun offer(): JSONObject = JSONObject().apply {
        put("callId", "11111111-1111-1111-1111-111111111111")
        put("channelId", "channel-1")
        put("channelName", "General")
        put("callerName", "Alice")
        put("livekitServerUrl", "wss://livekit.example.com")
        put("livekitToken", "recipient-scoped-token")
        put("ringStatusUrl", "https://dev.macro.com/call/ring-status/call-1")
    }
    @Test fun acceptsTheBackendCallEnvelope() {
        val parsed = CallOffer.parse(offer().toString(), 1000)
        assertEquals("channel-1", parsed.channelId)
        assertEquals("recipient-scoped-token", parsed.token)
        assertEquals(1000L, parsed.sentTime)
    }
    @Test fun refusesToSendBearerTokensToUntrustedOrInsecureRingEndpoints() {
        for (url in listOf("http://dev.macro.com/ring", "https://macro.com.evil.example/ring", "https://evil.example/ring", "https://user@macro.com/ring")) {
            assertThrows(IllegalArgumentException::class.java) { CallOffer.parse(offer().put("ringStatusUrl", url).toString(), 1000) }
        }
    }
    @Test fun requiresSecureMediaAndValidIdentity() {
        assertThrows(IllegalArgumentException::class.java) { CallOffer.parse(offer().put("livekitServerUrl", "ws://livekit.example.com").toString(), 1000) }
        assertThrows(IllegalArgumentException::class.java) { CallOffer.parse(offer().put("callId", "invalid").toString(), 1000) }
        assertThrows(IllegalArgumentException::class.java) { CallOffer.parse(offer().put("channelId", " ").toString(), 1000) }
        assertThrows(IllegalArgumentException::class.java) { CallOffer.parse(offer().put("livekitToken", " ").toString(), 1000) }
    }
}
