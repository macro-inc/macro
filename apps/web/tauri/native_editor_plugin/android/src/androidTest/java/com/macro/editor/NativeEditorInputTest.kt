package com.macro.editor

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeEditorInputTest {
    @Test fun clipboardPreservesRichTextAcrossSessions() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync { NativeClipboardScenario.run(instrumentation.targetContext) }
    }

    @Test fun consumedEnterKeepsTextAndPreventionAfterEffectFailure() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync { NativeInputScenario.consumedEnter(instrumentation.targetContext) }
    }

    @Test fun inputConnectionCommitsUnicodeCompositionAndUndo() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync { NativeInputScenario.run(instrumentation.targetContext) }
    }
}
