package com.macro.editor

import com.macro.documentsession.*
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Uses the application's existing token source and cancels its own outstanding requests. */
interface NativeTokenSource : AutoCloseable {
    fun fetch(doc: SyncDocId, complete: (String?, WriteAccess) -> Unit)
}

/** Platform executors only: protocol, retry, authorization and WAL policy stay in Rust. */
class NativeSessionAdapters(
    private val storage: NativeSessionStorage?,
    private val tokens: NativeTokenSource,
    private val client: OkHttpClient,
    private val socketRequest: (FfiIoEffect.SocketConnect) -> Request,
    private val peers: () -> List<ULong>,
    private val trace: (FfiTelemetry) -> Unit,
) : NativeSessionEffects {
    private val active = AtomicBoolean(true)
    private val storageQueue = Executors.newSingleThreadExecutor { task ->
        Thread(task, "NativeEditorStorage")
    }
    private class Connection(val event: (SocketEvent) -> Unit) {
        @Volatile var socket: WebSocket? = null
    }
    private val connections = ConcurrentHashMap<ConnId, Connection>()

    override fun fetchToken(effect: FfiIoEffect.FetchToken, complete: (String?, WriteAccess) -> Unit) {
        check(active.get())
        tokens.fetch(effect.doc) { token, access -> if (active.get()) complete(token, access) }
    }

    override fun connect(effect: FfiIoEffect.SocketConnect, event: (SocketEvent) -> Unit) {
        check(active.get())
        val entry = Connection(event)
        connections.put(effect.conn, entry)?.socket?.cancel()
        try {
            val socket = client.newWebSocket(socketRequest(effect), object : WebSocketListener() {
                private fun current() = active.get() && connections[effect.conn] === entry
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    if (current()) event(SocketEvent.Opened) else webSocket.cancel()
                }
                override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                    if (current()) event(SocketEvent.Frame(bytes.toByteArray()))
                }
                override fun onMessage(webSocket: WebSocket, text: String) {
                    if (current()) event(SocketEvent.Text(text))
                }
                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    webSocket.close(code, reason)
                }
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    finish(effect.conn, entry, code.toUShort(), true)
                }
                override fun onFailure(webSocket: WebSocket, error: Throwable, response: Response?) {
                    finish(effect.conn, entry, 1006u, false)
                }
            })
            entry.socket = socket
            if (!active.get() || connections[effect.conn] !== entry) socket.cancel()
        } catch (error: Exception) {
            finish(effect.conn, entry, 1006u, false)
            throw error
        }
    }

    override fun send(effect: FfiIoEffect.SocketSend) {
        val entry = requireNotNull(connections[effect.conn]) { "Socket generation is unavailable" }
        if (entry.socket?.send(effect.frame.toByteString()) != true) {
            finish(effect.conn, entry, 1006u, false)
            entry.socket?.cancel()
        }
    }

    override fun ping(effect: FfiIoEffect.SocketPing) {
        val entry = requireNotNull(connections[effect.conn]) { "Socket generation is unavailable" }
        // Match the existing web executor's application heartbeat, not a WebSocket control ping.
        if (entry.socket?.send("ping") != true) {
            finish(effect.conn, entry, 1006u, false)
            entry.socket?.cancel()
        }
    }

    override fun closeSocket(effect: FfiIoEffect.SocketClose) {
        connections[effect.conn]?.socket?.close(effect.code.toInt(), "")
    }

    private fun finish(conn: ConnId, entry: Connection, code: UShort, clean: Boolean) {
        if (connections.remove(conn, entry) && active.get()) entry.event(SocketEvent.Closed(code, clean))
    }

    override fun storage(effect: FfiIoEffect.Storage, complete: (FfiStorageResult) -> Unit) {
        check(active.get())
        storageQueue.execute {
            val result = try {
                requireNotNull(storage) { "Durable storage is not configured" }.execute(effect.opBody)
            } catch (error: Exception) {
                when (effect.opBody) {
                    is StorageOp.Load, is StorageOp.LoadOrphans -> FfiStorageResult.LoadFailed(StorageFailure.UNAVAILABLE)
                    is StorageOp.WalAdopt -> FfiStorageResult.AdoptFailed(StorageFailure.UNCERTAIN)
                    else -> FfiStorageResult.WriteFailed(StorageFailure.UNCERTAIN)
                }
            }
            if (active.get()) complete(result)
        }
    }

    override fun telemetry(record: FfiTelemetry) = trace(record)
    override fun freshPeers(): List<ULong> = peers()

    override fun close() {
        if (!active.compareAndSet(true, false)) return
        try { tokens.close() } finally {
            connections.values.forEach { it.socket?.cancel() }
            connections.clear()
            // Drain already accepted transactions before releasing the database and owner lease.
            storageQueue.execute { storage?.close() }
            storageQueue.shutdown()
        }
    }
}
