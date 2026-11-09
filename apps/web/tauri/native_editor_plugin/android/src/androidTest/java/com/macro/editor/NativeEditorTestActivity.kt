package com.macro.editor

import android.os.Bundle
import android.os.SystemClock
import android.view.inputmethod.InputMethodManager
import androidx.appcompat.app.AppCompatActivity
import com.macro.documentsession.*
import okhttp3.OkHttpClient
import java.security.SecureRandom

/** Device-only window over the actual memory session; no app account or backend. */
class NativeEditorTestActivity : AppCompatActivity() {
    private lateinit var session: NativeEditorSession
    private lateinit var host: NativeSessionHost
    private lateinit var editor: NativeEditorView
    var failure: Exception? = null
        private set
    var canRedo = false
        private set

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        fun now() = FfiNow(SystemClock.elapsedRealtime().toULong(), System.currentTimeMillis())
        session = NativeEditorSession(NativeInputScenario.config(), null, now())
        val client = OkHttpClient()
        val entropy = SecureRandom()
        val issued = mutableSetOf(7uL, 8uL, 9uL, 10uL)
        val adapters = NativeSessionAdapters(null, object : NativeTokenSource {
            override fun fetch(doc: SyncDocId, complete: (String?, WriteAccess) -> Unit) {
                complete(null, WriteAccess.NONE)
            }
            override fun close() = Unit
        }, client, { throw IllegalStateException("Memory fixture cannot connect") }, {
            buildList {
                while (size < 4) {
                    val peer = (entropy.nextLong() and Long.MAX_VALUE).toULong()
                    if (peer != 0uL && issued.add(peer)) add(peer)
                }
            }
        }, {})
        val effects = object : NativeSessionEffects by adapters {
            override fun close() {
                adapters.close()
                client.connectionPool.evictAll()
                client.dispatcher.executorService.shutdown()
            }
        }
        host = NativeSessionHost(session, effects, {
            if (it is FfiViewEffect.Error) failure = IllegalStateException(it.message)
        }, { failure = it }, ::now, { output ->
            output.view.filterIsInstance<FfiViewEffect.HistoryState>().forEach { canRedo = it.availability.canRedo }
        })
        host.admit(FfiInput.Start)
        host.admit(FfiInput.Seed(SeedKind.OPTIMISTIC, byteArrayOf()))
        host.admit(FfiInput.SetState(BridgeJson.root(
            """{"root":{"type":"root","children":[{"type":"paragraph","children":[]}]}}""")))
        val patch = session.query(FfiQuery.ViewDiff) as FfiQueryReply.ViewDiff
        val paragraph = patch.diff.ops.filterIsInstance<DiffOp.CreateElement>().first { it.key.index != 0u }.key
        host.admit(FfiInput.SelectionFromView(ViewSelection.Range(
            Point.Element(paragraph, 0u), Point.Element(paragraph, 0u), false), null))
        host.admit(FfiInput.Command(FfiCommand.ClearHistory, ViewSelection.KeepModel))
        editor = NativeEditorView(this, session, host, true, true)
        editor.contentDescription = "Native editor fixture"
        val inset = (16 * resources.displayMetrics.density).toInt()
        editor.setPadding(inset, inset, inset, inset)
        host.attach(editor)
        setContentView(editor)
        editor.post {
            if (!isFinishing && !isDestroyed) {
                editor.requestFocus()
                getSystemService(InputMethodManager::class.java).showSoftInput(editor, InputMethodManager.SHOW_IMPLICIT)
            }
        }
    }

    fun textContent(): String = session.textContent()

    override fun onDestroy() {
        if (::host.isInitialized) {
            if (::editor.isInitialized) host.detach(editor)
            host.stop(1u)
        }
        super.onDestroy()
    }
}
