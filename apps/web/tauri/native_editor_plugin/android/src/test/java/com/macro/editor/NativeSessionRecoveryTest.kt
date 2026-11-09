package com.macro.editor

import android.os.Looper
import com.macro.documentsession.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NativeSessionRecoveryTest {
    @Test fun realSessionWritesDrainAndRecoverThroughTypedStorageCompletions() = runRecovery(true)
    @Test fun walOnlyRecoveryLoadsBeforeOfferingTheOptimisticSeed() = runRecovery(false)

    private fun runRecovery(withSnapshot: Boolean) {
        val context = RuntimeEnvironment.getApplication()
        val writerConfig = NativeInputScenario.config()
        writerConfig.sync.doc = "recovery-fixture"
        writerConfig.sync.session = "00000000-0000-0000-0000-000000000021"
        writerConfig.sync.persistence = Persistence.DURABLE
        writerConfig.sync.snapshotInterval = if (withSnapshot) 100uL else null
        var tick = 0uL
        val clock = { FfiNow(tick++, 1_000_000L) }
        val writer = NativeEditorSession(writerConfig, null, clock())
        val writerEffects = LocalEffects(NativeSessionStorage(context, writerConfig.sync.doc,
            writerConfig.sync.session, writerConfig.sync.user))
        val host = NativeSessionHost(writer, writerEffects, {
            if (it is FfiViewEffect.Error) fail(it.message)
        }, { throw AssertionError(it) }, clock)
        host.admit(FfiInput.Start)
        shadowOf(Looper.getMainLooper()).idle()
        host.admit(FfiInput.Seed(SeedKind.OPTIMISTIC, byteArrayOf()))
        shadowOf(Looper.getMainLooper()).idle()
        host.admit(FfiInput.SetState(listOf(
            FfiValueEntry("type", FfiValue.Text("root")),
            FfiValueEntry("children", FfiValue.Array(listOf(FfiValue.Map(listOf(
                FfiValueEntry("type", FfiValue.Text("paragraph")),
                FfiValueEntry("children", FfiValue.Array(listOf(FfiValue.Map(listOf(
                    FfiValueEntry("type", FfiValue.Text("text")),
                    FfiValueEntry("text", FfiValue.Text("durable😀")),
                ))))),
            ))))),
        )))
        host.admit(FfiInput.Flush(1u))
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals("durable😀", writer.textContent())
        assertTrue(writerEffects.appends > 0)
        tick += 2000uL
        host.admit(FfiInput.Tick)
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(withSnapshot, writerEffects.snapshots > 0)
        host.stop(2u)
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(writerEffects.closed)

        val readerConfig = NativeInputScenario.config()
        readerConfig.sync.doc = "recovery-fixture"
        readerConfig.sync.session = "00000000-0000-0000-0000-000000000022"
        readerConfig.sync.persistence = Persistence.DURABLE
        readerConfig.peers = listOf(107uL, 108uL, 109uL, 110uL)
        val reader = NativeEditorSession(readerConfig, null, clock())
        val readerEffects = LocalEffects(NativeSessionStorage(context, readerConfig.sync.doc,
            readerConfig.sync.session, readerConfig.sync.user))
        readerEffects.holdAdoption = !withSnapshot
        var initialized = 0
        val reopened = NativeSessionHost(reader, readerEffects, {
            if (it is FfiViewEffect.Error) fail(it.message)
            if (it is FfiViewEffect.Initialize) initialized++
        }, { throw AssertionError(it) }, clock)
        reopened.admit(FfiInput.Start)
        shadowOf(Looper.getMainLooper()).idle()
        val adoption = if (withSnapshot) null else requireNotNull(readerEffects.finishAdoption)
        reopened.admit(FfiInput.Seed(SeedKind.OPTIMISTIC, byteArrayOf()))
        shadowOf(Looper.getMainLooper()).idle()
        if (!withSnapshot) assertEquals(0, initialized)
        adoption?.invoke()
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(1, initialized)
        assertEquals("durable😀", reader.textContent())
        assertEquals("durable😀", reader.markdown(FfiMarkdownFlavor.APPLICATION))
        reopened.stop(3u)
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(readerEffects.closed)
    }

    private class LocalEffects(private val store: NativeSessionStorage) : NativeSessionEffects {
        var appends = 0
        var snapshots = 0
        var closed = false
        var holdAdoption = false
        var finishAdoption: (() -> Unit)? = null
        override fun fetchToken(effect: FfiIoEffect.FetchToken, complete: (String?, WriteAccess) -> Unit) = fail("Unexpected token fetch")
        override fun connect(effect: FfiIoEffect.SocketConnect, event: (SocketEvent) -> Unit) = fail("Unexpected socket")
        override fun send(effect: FfiIoEffect.SocketSend) = fail("Unexpected send")
        override fun ping(effect: FfiIoEffect.SocketPing) = fail("Unexpected heartbeat")
        override fun closeSocket(effect: FfiIoEffect.SocketClose) = Unit
        override fun storage(effect: FfiIoEffect.Storage, complete: (FfiStorageResult) -> Unit) {
            if (effect.opBody is StorageOp.WalAppend) appends++
            if (effect.opBody is StorageOp.SnapshotSave) snapshots++
            val result = store.execute(effect.opBody)
            if (holdAdoption && effect.opBody is StorageOp.WalAdopt) finishAdoption = { complete(result) }
            else complete(result)
        }
        override fun telemetry(record: FfiTelemetry) = Unit
        override fun freshPeers() = listOf(207uL, 208uL, 209uL, 210uL)
        override fun close() { closed = true; store.close() }
    }
}
