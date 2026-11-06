package com.macro.call

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioOutputSelectionTest {
    @Test fun ignoresPreviousAndPendingSessions() {
        assertFalse(AudioOutputSelection.allowed("new-call", "old-call", true))
        assertFalse(AudioOutputSelection.allowed("new-call", "new-call", false))
        assertFalse(AudioOutputSelection.allowed(null, "old-call", true))
        assertTrue(AudioOutputSelection.allowed("new-call", "new-call", true))
    }
}
