package com.macro.editor

import com.macro.documentsession.*
import org.junit.Assert.*

internal object NativeAccessScenario {
    fun run() {
        val config = NativeInputScenario.config()
        val editor = NativeEditorSession(config, null, FfiNow(0uL, 1_000_000L))
        val generic = NativeDocSession(config.copy(application = null), null, FfiNow(0uL, 1_000_000L))
        try {
            assertEquals(Access.EDIT, editor.effectiveAccess())
            assertEquals(Access.EDIT, generic.effectiveAccess())
            editor.handle(FfiNow(0uL, 1_000_000L), FfiInput.Start)
            generic.handle(FfiNow(0uL, 1_000_000L), FfiInput.Start)
            editor.handle(FfiNow(1uL, 1_000_001L), FfiInput.Seed(SeedKind.OPTIMISTIC, byteArrayOf()))
            generic.handle(FfiNow(1uL, 1_000_001L), FfiInput.Seed(SeedKind.OPTIMISTIC, byteArrayOf()))
            editor.handle(FfiNow(2uL, 1_000_002L), FfiInput.SetState(BridgeJson.root("""{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"original"}]}]}}""")))
            val original = BridgeJson.state((editor.query(FfiQuery.State) as FfiQueryReply.State).root)
            listOf(Access.COMMENT_ONLY, Access.READ, Access.EDIT).forEachIndexed { index, access ->
                val tick = 3uL + index.toULong() * 2uL
                val auth = FfiInput.Authorization(AuthorizationState(true, access == Access.EDIT, access != Access.READ))
                editor.handle(FfiNow(tick, 1_000_000L + tick.toLong()), auth)
                generic.handle(FfiNow(tick, 1_000_000L + tick.toLong()), auth)
                assertEquals(access, editor.effectiveAccess())
                assertEquals(access, generic.effectiveAccess())
                val output = editor.handle(FfiNow(tick + 1uL, 1_000_001L + tick.toLong()),
                    FfiInput.Command(FfiCommand.ClearEditor, ViewSelection.KeepModel))
                if (access != Access.EDIT) {
                    assertTrue(output.view.any { it is FfiViewEffect.Error && it.message == "document is read-only" })
                    assertEquals(original, BridgeJson.state((editor.query(FfiQuery.State) as FfiQueryReply.State).root))
                } else {
                    assertTrue(output.view.none { it is FfiViewEffect.Error })
                    assertEquals("", editor.textContent())
                }
            }
        } finally {
            editor.close()
            generic.close()
        }
    }
}
