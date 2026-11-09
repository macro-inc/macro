package com.macro.editor

import android.os.Looper
import com.macro.documentsession.*
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NativeSessionAdaptersTest {
    @Test fun directSocketsPreserveFramesAndUseApplicationHeartbeat() {
        val server = MockWebServer()
        val serverFrames = LinkedBlockingQueue<ByteArray>()
        val serverTexts = LinkedBlockingQueue<String>()
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                serverFrames.add(bytes.toByteArray())
                webSocket.send(byteArrayOf(1, 9, 8).toByteString())
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                serverTexts.add(text)
                webSocket.send("pong")
            }
        }))
        server.start()
        val client = OkHttpClient()
        val storage = NativeSessionStorage(RuntimeEnvironment.getApplication(), "socket-fixture",
            "00000000-0000-0000-0000-000000000031", "fixture-user")
        val tokens = object : NativeTokenSource {
            override fun fetch(doc: SyncDocId, complete: (String?, WriteAccess) -> Unit) = complete(null, WriteAccess.NONE)
            override fun close() = Unit
        }
        val adapters = NativeSessionAdapters(storage, tokens, client,
            { Request.Builder().url(server.url("/document")).build() }, { listOf(17uL) }, {})
        val events = LinkedBlockingQueue<SocketEvent>()
        try {
            adapters.connect(FfiIoEffect.SocketConnect(1u, "socket-fixture", "fixture-token", null), events::add)
            assertEquals(SocketEvent.Opened, events.poll(10, TimeUnit.SECONDS))
            adapters.send(FfiIoEffect.SocketSend(1u, byteArrayOf(1, 0, -1)))
            assertArrayEquals(byteArrayOf(1, 0, -1), serverFrames.poll(10, TimeUnit.SECONDS))
            assertArrayEquals(byteArrayOf(1, 9, 8), (events.poll(10, TimeUnit.SECONDS) as SocketEvent.Frame).v1)
            adapters.ping(FfiIoEffect.SocketPing(1u))
            assertEquals("ping", serverTexts.poll(10, TimeUnit.SECONDS))
            assertEquals(SocketEvent.Text("pong"), events.poll(10, TimeUnit.SECONDS))
        } finally {
            adapters.close()
            storage.close()
            server.shutdown()
            client.dispatcher.executorService.shutdownNow()
            client.connectionPool.evictAll()
        }
    }

    @Test fun storageRunsOffUiThreadAndLateTokenResultsAreDiscarded() {
        val context = RuntimeEnvironment.getApplication()
        val owner = "00000000-0000-0000-0000-000000000032"
        val storage = NativeSessionStorage(context, "worker-fixture", owner, "fixture-user")
        var pending: ((String?, WriteAccess) -> Unit)? = null
        var tokenClosed = false
        val tokens = object : NativeTokenSource {
            override fun fetch(doc: SyncDocId, complete: (String?, WriteAccess) -> Unit) { pending = complete }
            override fun close() { tokenClosed = true }
        }
        val client = OkHttpClient()
        val adapters = NativeSessionAdapters(storage, tokens, client,
            { throw AssertionError("No socket expected") }, { listOf(17uL) }, {})
        val completed = CountDownLatch(1)
        val completion = AtomicReference<FfiStorageResult>()
        val thread = AtomicReference<Thread>()
        var tokenResults = 0
        try {
            adapters.storage(FfiIoEffect.Storage(1u, StorageOp.WalAppend("worker-fixture", owner,
                WalRecord(1uL, 1000L, "fixture-user", false, false, byteArrayOf(3)), false))) {
                thread.set(Thread.currentThread())
                completion.set(it)
                completed.countDown()
            }
            assertTrue(completed.await(10, TimeUnit.SECONDS))
            assertEquals(FfiStorageResult.Done, completion.get())
            assertNotEquals(Looper.getMainLooper().thread, thread.get())
            adapters.fetchToken(FfiIoEffect.FetchToken(1u, "worker-fixture")) { _, _ -> tokenResults++ }
            adapters.close()
            assertTrue(tokenClosed)
            requireNotNull(pending)("late-fixture-token", WriteAccess.FULL)
            assertEquals(0, tokenResults)
        } finally {
            adapters.close()
            storage.close()
            client.dispatcher.executorService.shutdownNow()
            client.connectionPool.evictAll()
        }
    }
}
