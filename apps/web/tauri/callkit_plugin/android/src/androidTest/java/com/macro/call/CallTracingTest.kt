package com.macro.call

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelFileDescriptor
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.opentelemetry.api.common.Attributes
import io.opentelemetry.api.trace.Span
import io.opentelemetry.api.trace.SpanKind
import io.opentelemetry.exporter.otlp.http.trace.OtlpHttpSpanExporter
import io.opentelemetry.sdk.resources.Resource
import io.opentelemetry.sdk.trace.SdkTracerProvider
import io.opentelemetry.sdk.trace.export.SimpleSpanProcessor
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** Exports actual protobuf over HTTP, including a backend parent and a downstream status request. */
@RunWith(AndroidJUnit4::class)
class CallTracingTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private fun shell(command: String) = ParcelFileDescriptor.AutoCloseInputStream(
        instrumentation.uiAutomation.executeShellCommand(command)).bufferedReader().use { it.readText() }

    @Test fun notificationAnswerAndStatusRequestExportOneConnectedTrace() {
        val exported = LinkedBlockingQueue<ByteArray>()
        val forwardUrl = InstrumentationRegistry.getArguments().getString("tracesUrl")
        val collector = MockWebServer().apply {
            dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val bytes = request.body.readByteArray()
                    // Optional local Tempo intake; no real call credentials or push delivery are involved.
                    if (forwardUrl != null) {
                        val http = URL(forwardUrl).openConnection() as HttpURLConnection
                        try {
                            http.requestMethod = "POST"; http.doOutput = true
                            http.connectTimeout = 5_000; http.readTimeout = 5_000
                            http.setRequestProperty("Content-Type", "application/x-protobuf")
                            http.outputStream.use { it.write(bytes) }
                            assertEquals(200, http.responseCode)
                        } finally { http.disconnect() }
                    }
                    exported.put(bytes)
                    return MockResponse().setResponseCode(200)
                }
            }
            start()
        }
        val endpoint = collector.url("/v1/traces").toString()
        val backend = SdkTracerProvider.builder()
            .setResource(Resource.create(Attributes.builder().put("service.name", "call-tracing-test-backend").build()))
            .addSpanProcessor(SimpleSpanProcessor.create(OtlpHttpSpanExporter.builder().setEndpoint(endpoint).build())).build()
        val tracer = backend.get("test-backend")
        val producer = tracer.spanBuilder("call.push.send").startSpan()
        val parent = io.opentelemetry.context.Context.root().with(producer)
        val headers = CallTracing.inject(parent)
        val traceId = producer.spanContext.traceId
        val status = MockWebServer().apply {
            dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val remote = CallTracing.extract(mapOf("traceparent" to request.getHeader("traceparent").orEmpty(),
                        "tracestate" to request.getHeader("tracestate").orEmpty()))
                    tracer.spanBuilder("call.ring_status.server").setParent(remote).setSpanKind(SpanKind.SERVER)
                        .startSpan().end()
                    return MockResponse().setBody("{\"status\":\"ended\"}")
                }
            }
            start()
        }
        try {
            val id = UUID.randomUUID().toString()
            val microphoneGranted = context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
            context.getSharedPreferences("macro_push", Context.MODE_PRIVATE).edit().putString("recipient", "trace-test-recipient").commit()
            if (Build.VERSION.SDK_INT >= 33) shell("pm grant ${context.packageName} android.permission.POST_NOTIFICATIONS")
            if (Build.VERSION.SDK_INT >= 34) shell("appops set ${context.packageName} USE_FULL_SCREEN_INTENT deny")
            instrumentation.runOnMainSync {
                Calls.end(context)
                CallTracing.configure(context, endpoint, "test")
                val payload = JSONObject().apply {
                    put("callId", id); put("channelId", "trace-test-channel")
                    put("channelName", "Private channel marker"); put("callerName", "Private caller marker")
                    put("livekitServerUrl", "wss://unused.invalid"); put("livekitToken", "secret-token-marker")
                    put("ringStatusUrl", "https://unavailable-call-test.macro.com/status")
                    headers.forEach { (key, value) -> put(key, value) }
                }
                Calls.receive(context, mapOf("recipientId" to "trace-test-recipient", "payload" to payload.toString()), System.currentTimeMillis())
            }
            producer.end()
            instrumentation.awaitCondition("Call notification was not posted") {
                context.getSystemService(NotificationManager::class.java).activeNotifications.any { it.id == CallService.NOTIFICATION_ID }
            }
            val activity = instrumentation.startActivitySync(Intent(context, CallActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as CallActivity
            instrumentation.runOnMainSync {
                assertEquals(traceId, Span.fromContext(Calls.trace!!.context).spanContext.traceId)
                // The foreground activity receives the real notification PendingIntent through onNewIntent.
                CallService.screen(context, Calls.offer!!.callId, answer = true).send()
            }
            instrumentation.awaitCondition("Notification Answer did not reach the activity") { activity.intent.getStringExtra("answer") == id }
            if (microphoneGranted) {
                instrumentation.awaitCondition("The initial answer verification did not finish") { Calls.error != null }
            }
            instrumentation.runOnMainSync {
                activity.onRequestPermissionsResult(4, arrayOf(Manifest.permission.RECORD_AUDIO), intArrayOf(PackageManager.PERMISSION_DENIED))
                val next = Calls.offer!!.copy(ringUrl = status.url("/ring-status").toString())
                Calls.answer(context, next.callId) { Calls.ringStatus(next) }
            }
            instrumentation.awaitCondition("The verified ended call was not resolved") { Calls.offer == null }
            val request = status.takeRequest(10, TimeUnit.SECONDS)
            assertNotNull(request)
            assertTrue(request!!.getHeader("traceparent")!!.startsWith("00-$traceId-"))
            assertFalse(request.getHeader("traceparent") == headers["traceparent"])

            var payload = ""
            while (!payload.contains("call.incoming")) {
                val bytes = exported.poll(10, TimeUnit.SECONDS)
                assertNotNull("Native spans were not exported", bytes)
                payload += bytes!!.toString(Charsets.UTF_8)
            }
            val remaining = mutableListOf<ByteArray>()
            exported.drainTo(remaining)
            payload += remaining.joinToString("") { it.toString(Charsets.UTF_8) }
            for (name in listOf("call.push.receive", "call.notification", "call.activity", "call.answer", "call.ring_status")) {
                assertTrue("Missing exported phase $name", payload.contains(name))
            }
            assertTrue(payload.contains(if (microphoneGranted) "already_granted" else "denied"))
            for (privateValue in listOf("Private caller marker", "Private channel marker", "secret-token-marker", "Authorization")) {
                assertFalse("Telemetry must exclude call content and credentials", payload.contains(privateValue))
            }
            // Disabling tracing while a permission phase is open must leave the ring alive,
            // close its trace, and stop propagating the old context on subsequent HTTP requests.
            instrumentation.runOnMainSync {
                val nextId = UUID.randomUUID().toString()
                val nextPayload = JSONObject().apply {
                    put("callId", nextId); put("channelId", "trace-test-channel")
                    put("channelName", "Private channel marker"); put("livekitServerUrl", "wss://unused.invalid")
                    put("livekitToken", "secret-token-marker"); put("ringStatusUrl", "https://unavailable-call-test.macro.com/status")
                    headers.forEach { (key, value) -> put(key, value) }
                }
                Calls.receive(context, mapOf("recipientId" to "trace-test-recipient", "payload" to nextPayload.toString()), System.currentTimeMillis())
                val permission = Calls.trace!!.phase("call.permission.microphone")
                CallTracing.configure(context, null, "test")
                assertNull(Calls.trace)
                assertEquals("Changing telemetry must not dismiss the call", nextId, Calls.offer?.callId)
                permission.end("granted")
                val next = Calls.offer!!.copy(ringUrl = status.url("/ring-status").toString())
                Calls.answer(context, next.callId) { Calls.ringStatus(next) }
            }
            instrumentation.awaitCondition("The call must still resolve with telemetry disabled") { Calls.offer == null }
            assertNull("Opt-out must detach the previous trace from HTTP", status.takeRequest(10, TimeUnit.SECONDS)!!.getHeader("traceparent"))
            // Re-enable the same exporter and exercise a real native media connection failure.
            shell("pm grant ${context.packageName} android.permission.RECORD_AUDIO")
            instrumentation.runOnMainSync {
                CallTracing.configure(context, endpoint, "test")
                val nextPayload = JSONObject().apply {
                    put("callId", UUID.randomUUID().toString()); put("channelId", "trace-test-channel")
                    put("livekitServerUrl", "wss://unused.invalid"); put("livekitToken", "secret-token-marker")
                    put("ringStatusUrl", "https://unavailable-call-test.macro.com/status")
                    headers.forEach { (key, value) -> put(key, value) }
                }
                Calls.receive(context, mapOf("recipientId" to "trace-test-recipient", "payload" to nextPayload.toString()), System.currentTimeMillis())
            }
            instrumentation.startActivitySync(Intent(context, CallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            instrumentation.runOnMainSync { Calls.answer(context, Calls.offer!!.callId) { "ringing" } }
            instrumentation.awaitCondition("The failed media connection must resolve") { Calls.offer == null }
            var failurePayload = ""
            while (!failurePayload.contains("call.connect")) {
                val bytes = exported.poll(10, TimeUnit.SECONDS)
                assertNotNull("Connection failure spans were not exported", bytes)
                failurePayload += bytes!!.toString(Charsets.UTF_8)
            }
            assertTrue(failurePayload.contains("connection_error"))
            assertFalse(failurePayload.contains("secret-token-marker"))
            java.io.File(context.getExternalFilesDir(null), "native-call-trace-id.txt").writeText(traceId)
            shell("cp ${context.getExternalFilesDir(null)}/native-call-trace-id.txt /sdcard/Download/native-call-trace-id.txt")
            instrumentation.runOnMainSync {
                CallTracing.configure(context, null, "test")
                val offer = CallOffer(UUID.randomUUID().toString(), "channel", "Test", "wss://unused.invalid", "token")
                assertNull("Telemetry opt-out must also disable cold native calls", CallTracing.start(context, offer))
            }
        } finally {
            instrumentation.runOnMainSync { Calls.end(context); CallTracing.configure(context, null, "test") }
            if (Build.VERSION.SDK_INT >= 34) shell("appops set ${context.packageName} USE_FULL_SCREEN_INTENT default")
            context.getSharedPreferences("macro_push", Context.MODE_PRIVATE).edit().clear().commit()
            status.close(); backend.close(); collector.close()
        }
    }
}
