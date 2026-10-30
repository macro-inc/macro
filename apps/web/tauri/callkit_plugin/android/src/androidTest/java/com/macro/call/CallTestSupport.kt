package com.macro.call

import android.app.Instrumentation
import android.util.Base64
import org.json.JSONObject
import org.junit.Assert.fail
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** A token for LiveKit's isolated `--dev` server (devkey/secret), used by the optional media tests. */
internal fun liveKitToken(identity: String, room: String, kind: String? = null): String {
    fun encode(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    val header = encode("{\"alg\":\"HS256\",\"typ\":\"JWT\"}".toByteArray())
    val payload = encode(JSONObject().apply {
        put("iss", "devkey"); put("sub", identity); kind?.let { put("kind", it) }
        put("exp", System.currentTimeMillis() / 1000 + 300)
        put("video", JSONObject().apply { put("roomJoin", true); put("room", room); put("canPublish", true); put("canSubscribe", true) })
    }.toString().toByteArray())
    val body = "$header.$payload"
    val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec("secret".toByteArray(), "HmacSHA256")) }
    return "$body.${encode(mac.doFinal(body.toByteArray()))}"
}

internal fun Instrumentation.awaitCondition(message: String, condition: () -> Boolean) {
    val deadline = System.currentTimeMillis() + 30_000
    while (System.currentTimeMillis() < deadline) {
        var ready = false
        runOnMainSync { ready = condition() }
        if (ready) return
        Thread.sleep(100)
    }
    fail(message)
}

internal fun Instrumentation.screenshot(name: String) {
    waitForIdleSync()
    // Idle messages can complete before SurfaceFlinger presents the next frame.
    Thread.sleep(300)
    uiAutomation.takeScreenshot().let { bitmap ->
        val file = java.io.File(targetContext.getExternalFilesDir(null), name)
        file.outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
        // Gradle removes test app data after the run; retain synthetic UI evidence.
        uiAutomation.executeShellCommand("cp ${file.absolutePath} /sdcard/Download/$name").close()
    }
}
