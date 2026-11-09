package com.macro.editor

import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class EditorClipboardTest {
    @Test fun applicationCodeAndLargePlainClipboardPolicies() {
        NativeClipboardPolicyScenario.run(RuntimeEnvironment.getApplication())
    }

    @Test fun structuredCopyPreservesFormattingAcrossRealSessions() {
        NativeClipboardScenario.run(RuntimeEnvironment.getApplication())
    }
}
