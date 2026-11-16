package com.macro.editor

import android.content.Context
import android.view.ContextThemeWrapper
import android.view.inputmethod.EditorInfo
import com.macro.documentsession.*
import org.junit.Assert.*

internal object NativeDecoratorScenario {
    fun run(targetContext: Context) {
        var tick = 0uL
        val host = object : NativeEditorHost {
            override fun now() = FfiNow(++tick, 1_000_000L + tick.toLong())
            override fun execute(output: FfiOutput, admit: (FfiInput) -> Unit) {
                assertTrue(output.io.all { it is FfiIoEffect.Telemetry })
            }
            override fun viewEffect(effect: FfiViewEffect) { if (effect is FfiViewEffect.Error) fail(effect.message) }
            override fun failed(error: Exception) { throw AssertionError(error) }
        }
        val session = NativeEditorSession(NativeInputScenario.config(), null, host.now())
        try {
            var reads = 0
            val observed = object : NativeEditorSessionInterface by session {
                override fun query(request: FfiQuery): FfiQueryReply {
                    if (request is FfiQuery.Decorators) reads++
                    return session.query(request)
                }
            }
            val view = NativeEditorView(ContextThemeWrapper(targetContext, androidx.appcompat.R.style.Theme_AppCompat),
                observed, host, true, true)
            view.admit(FfiInput.Start)
            view.admit(FfiInput.Seed(SeedKind.OPTIMISTIC, byteArrayOf()))
            view.admit(FfiInput.SetState(BridgeJson.root("""{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"😀 "},{"type":"user-mention","userId":"fixture-user","displayName":"Person"},{"type":"text","text":" tail"}]}]}}""")))
            val text = requireNotNull(view.text)
            assertEquals("😀 \uFFFC tail", text.toString())
            val chip = text.getSpans(0, text.length, NativeDecoratorSpan::class.java).single()
            assertEquals("@Person", chip.label)
            assertEquals(3, text.getSpanStart(chip))
            assertEquals(4, text.getSpanEnd(chip))
            if (android.os.Build.VERSION.SDK_INT >= 30) assertEquals("@Person", chip.contentDescription.toString())
            assertTrue(chip.getSize(view.paint, text, 3, 4, null) > 0)
            assertEquals(1, reads)
            view.setSelection(4)
            assertTrue(requireNotNull(view.onCreateInputConnection(EditorInfo())).commitText("!", 1))
            assertEquals("😀 \uFFFC! tail", view.text.toString())
            assertEquals("😀 @Person! tail", session.textContent())
            assertEquals(5, view.selectionStart)
            assertEquals("text-only input must reuse cached decorator facts", 1, reads)
            view.admit(FfiInput.SetState(BridgeJson.root("""{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"user-mention","userId":"fixture-other","displayName":"Other"}]}]}}""")))
            val replacement = requireNotNull(view.text).getSpans(0, view.length(), NativeDecoratorSpan::class.java).single()
            assertEquals("@Other", replacement.label)
            assertEquals("\uFFFC", view.text.toString())
            assertEquals(2, reads)
            assertFalse(requireNotNull(view.text).getSpans(0, view.length(), NativeDecoratorSpan::class.java).contains(chip))
        } finally { session.destroy() }
    }
}
