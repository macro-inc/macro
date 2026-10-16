package com.macro.call

import app.tauri.plugin.Invoke
import com.fasterxml.jackson.databind.ObjectMapper
import org.junit.Assert.*
import org.junit.Test

class ThemeArgsTest {
    @Test fun sharedThemeEnvelopeDeserializesThroughTheTauriBridge() {
        val invoke = Invoke(0, "setCallDrawerTheme", 0, 0, { _, _ -> },
            """{"theme":{"drawerBackground":{"red":0.2,"green":0.3,"blue":0.4,"alpha":1}}}""", ObjectMapper())
        val args = invoke.parseArgs(ThemeArgs::class.java)
        assertEquals(0.2, args.theme["drawerBackground"]!!["red"]!!, 0.0001)
        assertEquals(1.0, args.theme["drawerBackground"]!!["alpha"]!!, 0.0001)
    }
}
