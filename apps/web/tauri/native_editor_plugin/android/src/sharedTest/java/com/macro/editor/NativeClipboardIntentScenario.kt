package com.macro.editor

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.view.ContextThemeWrapper
import com.macro.documentsession.*
import org.junit.Assert.*

/** Actual Android clipboard event intent crosses JNI into the shared Markdown policy. */
internal object NativeClipboardIntentScenario {
    fun run(context: Context) {
        var tick = 0uL
        val host = object : NativeEditorHost {
            override fun now() = FfiNow(++tick, 1_000_000L + tick.toLong())
            override fun execute(output: FfiOutput, admit: (FfiInput) -> Unit) {
                assertTrue(output.io.all { it is FfiIoEffect.Telemetry })
            }
            override fun viewEffect(effect: FfiViewEffect) { if (effect is FfiViewEffect.Error) fail(effect.message) }
            override fun failed(error: Exception) { throw AssertionError(error) }
        }
        for (plainOnly in listOf(false, true)) {
            val session = NativeEditorSession(NativeInputScenario.config(), null, host.now())
            val view = NativeEditorView(ContextThemeWrapper(context, androidx.appcompat.R.style.Theme_AppCompat), session, host, true, true)
            try {
                view.admit(FfiInput.Start)
                view.admit(FfiInput.Seed(SeedKind.OPTIMISTIC, byteArrayOf()))
                view.admit(FfiInput.SetState(BridgeJson.root("""{"root":{"type":"root","children":[{"type":"paragraph","children":[]}]}}""")))
                view.setSelection(0)
                context.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("", "**literal**"))
                assertTrue(view.onTextContextMenuItem(if (plainOnly) android.R.id.pasteAsPlainText else android.R.id.paste))
                assertEquals(if (plainOnly) "**literal**" else "literal", session.textContent())
                val diff = (session.query(FfiQuery.ViewDiff) as FfiQueryReply.ViewDiff).diff
                val text = diff.ops.filterIsInstance<DiffOp.CreateText>().single()
                assertEquals(if (plainOnly) 0u else 1u, text.base.format)
            } finally { view.detachFromSession(); session.close() }
        }
    }
}
