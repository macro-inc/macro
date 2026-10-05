package com.macro.mobile

import android.app.Activity
import android.content.Intent
import android.content.res.Configuration
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResult
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.annotation.Command
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@TauriPlugin
class MobilePlugin(private val activity: Activity) : Plugin(activity) {
    private lateinit var webView: WebView
    private val files = MobileFiles(activity)
    private val exports = MobileExports(activity)
    private var insets = JSObject()
    private var backPending = false
    // A page that reloads mid-dispatch never answers; let the next press through.
    private val releaseBack = Runnable { backPending = false }

    private companion object {
        const val BACK_ANSWER_TIMEOUT_MS = 2_000L
    }

    override fun load(webView: WebView) {
        this.webView = webView
        // Listen on the WebView, leaving the window's own inset dispatch intact.
        ViewCompat.setOnApplyWindowInsetsListener(webView) { _, value ->
            updateInsets(value)
            value
        }
        webView.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
            ViewCompat.getRootWindowInsets(webView)?.let { updateInsets(it) }
        }
        ViewCompat.requestApplyInsets(webView)
        (activity as ComponentActivity).onBackPressedDispatcher.addCallback(
            activity,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    val value = ViewCompat.getRootWindowInsets(webView)
                    if (value?.isVisible(WindowInsetsCompat.Type.ime()) == true) {
                        WindowInsetsControllerCompat(activity.window, webView)
                            .hide(WindowInsetsCompat.Type.ime())
                        return
                    }
                    if (backPending) return
                    backPending = true
                    webView.postDelayed(releaseBack, BACK_ANSWER_TIMEOUT_MS)
                    // Only a committed Back reaches JS. Canceled predictive gestures
                    // must never dismiss a sheet or navigate away from a draft.
                    webView.evaluateJavascript(
                        "window.dispatchEvent(new Event('android-back', {cancelable:true}))"
                    ) { unhandled ->
                        webView.removeCallbacks(releaseBack)
                        backPending = false
                        // "false" means JS claimed it; "null" means no page is loaded yet.
                        if (unhandled != "false") activity.moveTaskToBack(true)
                    }
                }
            }
        )
        receiveShare(activity.intent)
    }

    private fun updateInsets(value: WindowInsetsCompat) {
        val scale = activity.resources.displayMetrics.density
        val bars = value.getInsets(
            WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
        )
        val imeVisible = value.isVisible(WindowInsetsCompat.Type.ime())
        val ime = value.getInsets(WindowInsetsCompat.Type.ime())
        // The WebView keeps its full edge-to-edge size under the keyboard, as on
        // iOS. Resizing it here made Chromium relayout the whole document on top
        // of the CSS work; instead JS shrinks the layout root through --dvh and
        // lifts fixed sheets by the published keyboard height.
        val next = JSObject().apply {
            put("top", bars.top / scale)
            put("right", bars.right / scale)
            // The keyboard covers the navigation bar, so its inset no longer applies.
            put("bottom", if (ime.bottom > 0) 0 else bars.bottom / scale)
            put("left", bars.left / scale)
            put("imeVisible", imeVisible)
            put("imeHeight", if (imeVisible) ime.bottom / scale else 0)
            // Width is what JS scales by: a keyboard never changes it, a density change does.
            put("viewportWidth", webView.width / scale)
            put("viewportHeight", webView.height / scale)
        }
        if (next.toString() != insets.toString()) {
            insets = next
            trigger("insets", next)
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        if (::webView.isInitialized) ViewCompat.requestApplyInsets(webView)
    }

    override fun onResume(activity: AppCompatActivity) {
        if (::webView.isInitialized) ViewCompat.requestApplyInsets(webView)
    }

    override fun onDestroy(activity: AppCompatActivity) {
        files.close()
        exports.close()
    }

    override fun onNewIntent(intent: Intent) = receiveShare(intent)

    private fun receiveShare(intent: Intent?) {
        if (intent == null || intent.action !in listOf(Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE)) return
        if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return
        // Do not re-ingest the launch intent on activity recreation. The queue is
        // durable, so it survives an authentication detour and process restart.
        val incoming = Intent(intent)
        intent.action = Intent.ACTION_MAIN
        files.receive(incoming) { error ->
            activity.runOnUiThread {
                trigger("shares", JSObject().apply { put("error", error) })
            }
        }
    }

    @Command
    fun getInsets(invoke: Invoke) {
        ViewCompat.getRootWindowInsets(webView)?.let { updateInsets(it) }
        invoke.resolve(insets)
    }

    @Command fun getPendingShares(invoke: Invoke) = files.getPendingShares(invoke)
    @Command fun register_listener(invoke: Invoke) = super.registerListener(invoke)
    @Command fun remove_listener(invoke: Invoke) = super.removeListener(invoke)
    @Command fun clearShares(invoke: Invoke) = files.clearShares(invoke) {
        activity.runOnUiThread { trigger("shares", JSObject()) }
    }
    @Command fun stageClipboardImage(invoke: Invoke) = files.stageClipboardImage(invoke)
    @Command fun beginExport(invoke: Invoke) = exports.begin(invoke)
    @Command fun appendExport(invoke: Invoke) = exports.append(invoke)
    @Command fun discardExport(invoke: Invoke) = exports.discard(invoke)
    @Command fun finishExport(invoke: Invoke) = exports.finish(invoke) { intent ->
        startActivityForResult(invoke, intent, "exportSaved")
    }
    @ActivityCallback fun exportSaved(invoke: Invoke, result: ActivityResult) = exports.saved(invoke, result)
}
