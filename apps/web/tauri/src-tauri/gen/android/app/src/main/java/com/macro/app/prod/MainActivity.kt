package com.macro.app.prod

import android.os.Bundle
import android.content.Context
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  companion object {
    init { System.loadLibrary("app_lib") }
  }

  private external fun initializeCertificateVerifier(context: Context): Boolean

  override fun onCreate(savedInstanceState: Bundle?) {
    check(initializeCertificateVerifier(applicationContext)) {
      "Unable to initialize Android certificate verification"
    }
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}
