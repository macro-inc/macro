package com.macro.editor

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.macro.documentsession.*

/** Application adapters execute typed effects; storage completes after its transaction. */
interface NativeSessionEffects {
    fun fetchToken(effect: FfiIoEffect.FetchToken, complete: (String?, WriteAccess) -> Unit)
    fun connect(effect: FfiIoEffect.SocketConnect, event: (SocketEvent) -> Unit)
    fun send(effect: FfiIoEffect.SocketSend)
    fun ping(effect: FfiIoEffect.SocketPing)
    fun closeSocket(effect: FfiIoEffect.SocketClose)
    fun storage(effect: FfiIoEffect.Storage, complete: (FfiStorageResult) -> Unit)
    fun telemetry(record: FfiTelemetry)
    fun freshPeers(): List<ULong>
    fun close()
}

/** A session outlives its view. All callbacks enter through the main-thread queue. */
class NativeSessionHost(
    val session: NativeEditorSession,
    private val effects: NativeSessionEffects,
    private val onViewEffect: (FfiViewEffect) -> Unit,
    private val onFailure: (Exception) -> Unit,
    private val clock: () -> FfiNow = { FfiNow(SystemClock.elapsedRealtime().toULong(), System.currentTimeMillis()) },
    private val observe: (FfiOutput) -> Unit = {},
) : NativeEditorHost {
    private val handler = Handler(Looper.getMainLooper())
    private var view: NativeEditorView? = null
    private var timer: Runnable? = null
    private var stopping: UInt? = null
    private var stopped = false
    private val pending = java.util.ArrayDeque<() -> FfiOutput>()
    private var admitting = false

    override fun now(): FfiNow = clock()

    /** Attach only after initialization; construction must not restart a live session. */
    fun attach(editor: NativeEditorView) {
        checkMainThread()
        check(!stopped && stopping == null)
        check(view == null || view === editor)
        editor.attachRunningSession()
        view = editor
    }

    fun detach(editor: NativeEditorView) {
        checkMainThread()
        if (view !== editor) return
        // End platform composition while the old view can still receive corrections.
        editor.detachFromSession()
        view = null
        admit(FfiInput.Focus(false))
    }

    /** Start, seed, lifecycle and I/O admissions also work while no view is mounted. */
    fun admit(input: FfiInput) {
        admitOperation { session.handle(now(), input) }
    }

    fun applicationCommand(name: String, payload: JsonValue, generation: UInt) {
        admitOperation { session.applicationCommand(now(), name, payload, generation, ViewSelection.KeepModel) }
    }

    private fun admitOperation(operation: () -> FfiOutput) {
        checkMainThread()
        if (stopped) return
        pending.addLast(operation)
        if (admitting) return
        admitting = true
        try {
            while (!stopped && pending.isNotEmpty()) handle(pending.removeFirst())
        } finally {
            admitting = false
            if (stopped) pending.clear()
        }
    }

    private fun handle(operation: () -> FfiOutput) {
        try {
            val output = operation()
            try {
                val mounted = view
                if (mounted == null) output.view.forEach(::viewEffect)
                else mounted.acceptOutput(output)
            } finally { execute(output, ::admit) }
        } catch (error: Exception) {
            failed(error)
        }
    }

    /** Keep the session alive until the shared core confirms its terminal write. */
    fun stop(request: UInt) {
        checkMainThread()
        if (stopped || stopping != null) return
        view?.setEditable(false)
        stopping = request
        admit(FfiInput.Stop(request))
    }

    override fun execute(output: FfiOutput, admit: (FfiInput) -> Unit) {
        checkMainThread()
        if (stopped) return
        try { observe(output) } catch (error: Exception) { failed(error) }
        timer?.let(handler::removeCallbacks)
        timer = null
        for (effect in output.io) {
            try {
                when (effect) {
                    is FfiIoEffect.FetchToken -> effects.fetchToken(effect) { token, access ->
                        enqueue(FfiInput.Token(effect.attempt, token, access))
                    }
                    is FfiIoEffect.SocketConnect -> effects.connect(effect) { event ->
                        enqueue(FfiInput.Socket(effect.conn, event))
                    }
                    is FfiIoEffect.SocketSend -> effects.send(effect)
                    is FfiIoEffect.SocketPing -> effects.ping(effect)
                    is FfiIoEffect.SocketClose -> effects.closeSocket(effect)
                    is FfiIoEffect.Storage -> effects.storage(effect) { result ->
                        enqueue(FfiInput.Storage(effect.op, result))
                    }
                    is FfiIoEffect.Telemetry -> effects.telemetry(effect.record)
                }
            } catch (error: Exception) {
                // A thrown executor call never implies a durable completion.
                failed(error)
            }
        }
        if (output.needPeerIds) {
            try {
                val peers = effects.freshPeers()
                require(peers.isNotEmpty()) { "Fresh peer identities are required" }
                enqueue(FfiInput.AddPeerIds(peers))
            } catch (error: Exception) { failed(error) }
        }
        output.wakeAtMs?.let { deadline ->
            val current = now().monoMs
            val delay = if (deadline <= current) 0L else (deadline - current).coerceAtMost(Long.MAX_VALUE.toULong()).toLong()
            val wake = Runnable { timer = null; this.admit(FfiInput.Tick) }
            timer = wake
            handler.postDelayed(wake, delay)
        }
        if (output.view.any {
            it is FfiViewEffect.Reply && it.request == stopping && it.reply is FfiReply.Stopped
        }) {
            stopped = true
            timer?.let(handler::removeCallbacks)
            timer = null
            view = null
            try { effects.close() } finally { session.close() }
        }
    }

    private fun enqueue(input: FfiInput) {
        // Always queue, even for synchronous completions, so effects never reenter handle.
        handler.post { if (!stopped) admit(input) }
    }

    override fun viewEffect(effect: FfiViewEffect) {
        handler.post { onViewEffect(effect) }
    }
    override fun failed(error: Exception) {
        handler.post { onFailure(error) }
    }

    private fun checkMainThread() = check(Looper.myLooper() == Looper.getMainLooper())
}
