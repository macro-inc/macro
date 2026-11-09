package com.macro.editor

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeEditorInputTest {
    @Test fun snippetsKeepTheConfirmedSourceExtractionCache() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync { NativeSnippetScenario.sourceCache(instrumentation.targetContext) }
    }

    @Test fun sourceSnippetResolutionPreservesNativeCaretAndHistory() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync { NativeSnippetScenario.run(instrumentation.targetContext) }
    }

    @Test fun applicationCodeAndLargePlainClipboardPolicies() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync { NativeClipboardPolicyScenario.run(instrumentation.targetContext) }
    }

    @Test fun codeRedoPreservesRawJsonAndCaret() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync {
            NativeHistoryScenario.restoredCodeIdentity(instrumentation.targetContext, false)
            NativeHistoryScenario.restoredCodeIdentity(instrumentation.targetContext, true)
        }
    }

    @Test fun nativeMenusSelectTypedMentionsAndPreserveLiteralOnDismiss() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync { NativeMenuScenario.run(instrumentation.targetContext) }
    }

    @Test fun clipboardPreservesRichTextAcrossSessions() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync { NativeClipboardScenario.run(instrumentation.targetContext) }
    }

    @Test fun consumedEnterKeepsTextAndPreventionAfterEffectFailure() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync { NativeInputScenario.consumedEnter(instrumentation.targetContext) }
    }

    @Test fun newlineCommitAppliesFinalCharactersBeforeCompositionEnd() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync { NativeInputScenario.newlineCommit(instrumentation.targetContext, listOf(true)) }
    }

    @Test fun newlineOnlyCommitUsesLiveElementBeforeCompositionEnd() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync { NativeInputScenario.newlineCommit(instrumentation.targetContext, listOf(false)) }
    }

    @Test fun inputConnectionCommitsUnicodeCompositionAndUndo() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync { NativeInputScenario.run(instrumentation.targetContext) }
    }
}
