package com.macro.auth

import org.junit.After
import org.junit.Assert.*
import org.junit.Test

class AuthSessionTest {
    private val expected = "macro://android-auth/123e4567-e89b-42d3-a456-426614174000"
    private val session = AuthSession.Pending("https://example.com/login", expected, 42)

    @After fun cleanup() {
        AuthSession.pending?.let { AuthSession.clear(it.callbackUrl) }
    }

    @Test fun staleCallbackLeavesTheCurrentSessionAvailable() {
        assertTrue(AuthSession.begin(session))
        assertNull(AuthSession.receive(expected.replace("174000", "174001") + "?token=stale"))
        assertEquals(session, AuthSession.matching("$expected?token=current"))
        assertEquals(42, AuthSession.matching(expected)?.taskId)
    }

    @Test fun recordsTheFirstValidRedirectBeforeBrowserCancellation() {
        assertTrue(AuthSession.begin(session))
        val callback = "$expected?token=current"
        assertEquals(callback, AuthSession.receive(callback)?.receivedCallback)
        assertEquals(callback, AuthSession.pending?.receivedCallback)
        assertNull(AuthSession.receive("$expected?token=duplicate"))
        assertEquals(callback, AuthSession.pending?.receivedCallback)
    }

    @Test fun absentOrFinishedSessionsCannotBeResurrectedByCallbacks() {
        assertNull(AuthSession.matching("$expected?token=orphan"))
        assertTrue(AuthSession.begin(session))
        AuthSession.clear(expected)
        assertNull(AuthSession.matching("$expected?token=duplicate"))
        assertTrue(AuthSession.begin(session.copy(callbackUrl = expected.replace("174000", "174001"))))
    }

    @Test fun overlappingAttemptsAndOldCleanupCannotReplaceTheCurrentSession() {
        assertTrue(AuthSession.begin(session))
        assertFalse(AuthSession.begin(session.copy(taskId = 99)))
        AuthSession.clear(expected.replace("174000", "174001"))
        assertEquals(session, AuthSession.pending)
    }
}
