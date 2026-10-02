package com.macro.auth

import org.junit.Assert.*
import org.junit.Test

class AuthCallbackTest {
    private val expected = "macro://android-auth/123e4567-e89b-42d3-a456-426614174000"

    @Test fun acceptsOnlyTheCurrentAttempt() {
        assertTrue(AuthCallback.matches(expected, "$expected?token=one-time-code"))
        assertTrue(AuthCallback.matches(expected, expected)) // GitHub linking has no session code.
        for (callback in listOf(
            expected.replace("174000", "174001") + "?token=stale",
            expected.replace("macro:", "https:"),
            expected.replace("android-auth", "evil.example"),
            expected.replace("android-auth", "user@android-auth"),
            "$expected/extra?token=wrong-path",
            "$expected#token=fragment",
            "not a URL"
        )) {
            assertFalse(callback, AuthCallback.matches(expected, callback))
        }
    }

    @Test fun rejectsInvalidExpectedCallbacks() {
        assertFalse(AuthCallback.isExpectedUrl("macro://android-auth/fixed"))
        assertFalse(AuthCallback.isExpectedUrl("$expected?token=old"))
        assertFalse(AuthCallback.isExpectedUrl("$expected#fragment"))
    }

    @Test fun decodesParametersOnce() {
        assertEquals("one+code", AuthCallback.parameters("$expected?token=one%2Bcode")["token"])
        assertEquals("access_denied", AuthCallback.parameters("$expected?error=access_denied")["error"])
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsDuplicateTokens() {
        AuthCallback.parameters("$expected?token=first&%74oken=second")
    }
}
