package com.macro.editor

import android.app.Activity
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.fasterxml.jackson.module.kotlin.readValue
import com.macro.documentsession.HostSignal
import com.macro.editor.bridge.*
import okhttp3.OkHttpClient

@InvokeArg
internal class BeginAccountArgs { lateinit var channel: Channel }

/** Tauri carries lifecycle and application callbacks; editing stays in native Rust/Kotlin. */
@TauriPlugin
class NativeEditorPlugin(private val activity: Activity) : Plugin(activity) {
    private val client = OkHttpClient()
    private val channels = mutableMapOf<Long, Channel>()
    private var surfaces: NativeEditorSurfaces? = null

    override fun load(webView: WebView) {
        check(surfaces == null)
        surfaces = NativeEditorSurfaces(activity, webView, client) { event ->
            channels[event.scope.accountGeneration]?.send(JSObject(mapper.writeValueAsString(event)))
            if (event.kind == SurfaceEventKind.Stopped && surfaces?.hasAccount(event.scope.accountGeneration) == false) {
                channels.remove(event.scope.accountGeneration)
            }
        }
    }

    @Command
    fun beginAccount(invoke: Invoke) = onUi(invoke) {
        val channel = invoke.parseArgs(BeginAccountArgs::class.java).channel
        val reply = controller().beginAccount(request<AccountRequest>(invoke))
        channels[reply.accountGeneration] = channel
        channels.keys.toList().filter { it != reply.accountGeneration && !controller().hasAccount(it) }
            .forEach(channels::remove)
        invoke.resolveObject(reply)
    }

    @Command fun create(invoke: Invoke) = onUi(invoke) { controller().create(request(invoke)); invoke.resolve() }
    @Command fun mount(invoke: Invoke) = onUi(invoke) { controller().mount(request(invoke)); invoke.resolve() }
    @Command fun layout(invoke: Invoke) = onUi(invoke) { controller().layout(request(invoke)); invoke.resolve() }
    @Command fun focus(invoke: Invoke) = onUi(invoke) { controller().focus(request(invoke)); invoke.resolve() }
    @Command fun permissions(invoke: Invoke) = onUi(invoke) { controller().permissions(request(invoke)); invoke.resolve() }
    @Command fun tokenResult(invoke: Invoke) = onUi(invoke) { controller().token(request(invoke)); invoke.resolve() }
    @Command fun action(invoke: Invoke) = onUi(invoke) { controller().action(request(invoke)); invoke.resolve() }
    @Command fun menuRows(invoke: Invoke) = onUi(invoke) { controller().menuRows(request(invoke)); invoke.resolve() }
    @Command fun menuCommit(invoke: Invoke) = onUi(invoke) { controller().menuCommit(request(invoke)); invoke.resolve() }
    @Command fun query(invoke: Invoke) = onUi(invoke) { invoke.resolveObject(controller().query(request(invoke))) }
    @Command fun lifecycle(invoke: Invoke) = onUi(invoke) { controller().lifecycle(request<LifecycleRequest>(invoke)); invoke.resolve() }
    @Command fun unmount(invoke: Invoke) = onUi(invoke) { controller().unmount(request(invoke)); invoke.resolve() }
    @Command fun stop(invoke: Invoke) = onUi(invoke) { controller().stop(request(invoke)); invoke.resolve() }

    override fun onPause(activity: AppCompatActivity) { surfaces?.lifecycle(HostSignal.HIDDEN) }
    override fun onResume(activity: AppCompatActivity) { surfaces?.lifecycle(HostSignal.VISIBLE) }
    override fun onDestroy(activity: AppCompatActivity) {
        channels.clear()
        surfaces?.dispose {
            client.connectionPool.evictAll()
            client.dispatcher.executorService.shutdown()
        }
        surfaces = null
    }

    private fun controller() = requireNotNull(surfaces) { "Native editor plugin is not loaded" }
    private inline fun <reified T> request(invoke: Invoke): T =
        mapper.readValue(invoke.getArgs().getJSONObject("request").toString())

    private fun onUi(invoke: Invoke, action: () -> Unit) {
        activity.runOnUiThread {
            try { action() } catch (error: Exception) { invoke.reject(error.message ?: "Native editor operation failed") }
        }
    }
}
