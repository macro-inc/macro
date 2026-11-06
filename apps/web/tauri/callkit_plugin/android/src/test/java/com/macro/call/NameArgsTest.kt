package com.macro.call

import app.tauri.plugin.Invoke
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.Assert.*
import org.junit.Test

class NameArgsTest {
    @Test fun sharedNullDisplayNamePayloadDeserializes() {
        val invoke = Invoke(0, "setParticipantDisplayName", 0, 0, { _, _ -> },
            "{\"identity\":\"participant\",\"displayName\":null}", ObjectMapper())
        val args = invoke.parseArgs(NameArgs::class.java)
        assertEquals("participant", args.identity)
        assertNull(args.displayName)
    }
}
