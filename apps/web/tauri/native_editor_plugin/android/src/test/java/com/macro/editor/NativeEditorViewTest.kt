package com.macro.editor

import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NativeEditorViewTest {
    @Test fun effectiveAccessTracksServerDowngradeAndRegrant() {
        NativeAccessScenario.run()
    }

    @Test fun snippetsKeepTheConfirmedSourceExtractionCache() {
        NativeSnippetScenario.sourceCache(RuntimeEnvironment.getApplication())
    }

    @Test fun sourceSnippetResolutionPreservesNativeCaretAndHistory() {
        NativeSnippetScenario.run(RuntimeEnvironment.getApplication())
    }

    @Test fun defaultCodeRedoPreservesRawJsonAndCaret() {
        NativeHistoryScenario.restoredCodeIdentity(RuntimeEnvironment.getApplication(), false)
    }
    @Test fun applicationCodeRedoPreservesRawJsonAndCaret() {
        NativeHistoryScenario.restoredCodeIdentity(RuntimeEnvironment.getApplication(), true)
    }

    @Test fun nativeMentionLabelsKeepAtomicUtf16PositionsAndReuseModelFacts() {
        NativeDecoratorScenario.run(RuntimeEnvironment.getApplication())
    }

    @Test fun consumedEnterKeepsTextAndPreventionAfterEffectFailure() {
        NativeInputScenario.consumedEnter(RuntimeEnvironment.getApplication())
    }

    @Test fun newlineCommitAppliesFinalCharactersBeforeCompositionEnd() {
        NativeInputScenario.newlineCommit(RuntimeEnvironment.getApplication(), listOf(true))
    }

    @Test fun newlineOnlyCommitUsesLiveElementBeforeCompositionEnd() {
        NativeInputScenario.newlineCommit(RuntimeEnvironment.getApplication(), listOf(false))
    }

    @Test fun realRustSessionReceivesInputConnectionCompositionAndHistory() {
        NativeInputScenario.run(RuntimeEnvironment.getApplication())
    }
}
