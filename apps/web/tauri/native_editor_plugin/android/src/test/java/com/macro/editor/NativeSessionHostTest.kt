package com.macro.editor

import android.os.Looper
import com.macro.documentsession.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NativeSessionHostTest {
    @Test fun callbacksAreQueuedAndIgnoredAfterTheCoreStops() {
        val config = NativeInputScenario.config()
        config.sync.transport = TransportKind.DIRECT
        var tick = 0uL
        val clock = { FfiNow(tick++, 1_000_000L) }
        val session = NativeEditorSession(config, null, clock())
        var tokenCompletion: ((String?, WriteAccess) -> Unit)? = null
        var fetching = false
        var closed = false
        var observations = 0
        val effects = object : NativeSessionEffects {
            override fun fetchToken(effect: FfiIoEffect.FetchToken, complete: (String?, WriteAccess) -> Unit) {
                assertFalse(fetching)
                fetching = true
                tokenCompletion = complete
                // Synchronous provider completion must not reenter session/view callbacks.
                complete(null, WriteAccess.NONE)
                fetching = false
            }
            override fun connect(effect: FfiIoEffect.SocketConnect, event: (SocketEvent) -> Unit) = fail("Unexpected socket")
            override fun send(effect: FfiIoEffect.SocketSend) = fail("Unexpected send")
            override fun ping(effect: FfiIoEffect.SocketPing) = fail("Unexpected heartbeat")
            override fun closeSocket(effect: FfiIoEffect.SocketClose) = Unit
            override fun storage(effect: FfiIoEffect.Storage, complete: (FfiStorageResult) -> Unit) = fail("Unexpected storage")
            override fun telemetry(record: FfiTelemetry) = Unit
            override fun freshPeers(): List<ULong> = listOf(11uL, 12uL)
            override fun close() { closed = true }
        }
        val host = NativeSessionHost(session, effects, {
            assertFalse(fetching)
            observations++
        }, { throw AssertionError(it) }, clock)
        host.admit(FfiInput.Start)
        assertNotNull(tokenCompletion)
        shadowOf(Looper.getMainLooper()).idle()
        host.stop(44u)
        assertTrue(closed)
        shadowOf(Looper.getMainLooper()).idle()
        val stoppedObservations = observations
        requireNotNull(tokenCompletion)("late-token", WriteAccess.FULL)
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(stoppedObservations, observations)
        host.stop(44u)
    }
}
