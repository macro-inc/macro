package com.macro.call

import android.os.Bundle
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.appcompat.app.AppCompatActivity

/** Forwards the lifecycle callbacks Tauri delivers to [CallPlugin] in the app. */
class MiniWindowHostActivity : AppCompatActivity() {
    private lateinit var plugin: CallPlugin
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(FrameLayout(this))
        plugin = CallPlugin(this)
        plugin.load(WebView(this))
    }
    override fun onResume() { super.onResume(); plugin.onResume(this) }
    override fun onStop() { super.onStop(); plugin.onStop(this) }
    override fun onDestroy() { plugin.onDestroy(this); super.onDestroy() }
}
