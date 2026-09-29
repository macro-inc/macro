package com.macro.app.prod

import android.os.Bundle
import android.content.Context
import android.content.Intent
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  companion object {
    init { System.loadLibrary("app_lib") }
  }

  private external fun initializeCertificateVerifier(context: Context): Boolean

  override fun onNewIntent(intent: Intent) {
    // Android can restore an existing task before Tauri's plugins have loaded.
    // Keep its latest intent available for the push plugin's load callback.
    setIntent(intent)
    super.onNewIntent(intent)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    check(initializeCertificateVerifier(applicationContext)) {
      "Unable to initialize Android certificate verification"
    }
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}
