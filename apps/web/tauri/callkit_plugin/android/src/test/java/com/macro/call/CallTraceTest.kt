package com.macro.call

import io.opentelemetry.api.common.AttributeKey
import io.opentelemetry.api.trace.SpanKind
import io.opentelemetry.api.trace.StatusCode
import io.opentelemetry.context.Context
import io.opentelemetry.sdk.testing.exporter.InMemorySpanExporter
import io.opentelemetry.sdk.trace.SdkTracerProvider
import io.opentelemetry.sdk.trace.export.SimpleSpanProcessor
import org.junit.Assert.*
import org.junit.Test

class CallTraceTest {
    @Test fun phasesPreserveRemoteParentsAndRedactExceptions() {
        val exporter = InMemorySpanExporter.create()
        SdkTracerProvider.builder().addSpanProcessor(SimpleSpanProcessor.create(exporter)).build().use { provider ->
            val parent = CallTracing.extract(mapOf("traceparent" to "00-11111111111111111111111111111111-2222222222222222-01"))
            val call = CallTrace(provider.get("test"), "test-call", parent)
            val answer = call.phase("call.answer")
            val request = call.phase("call.ring_status", answer.context, SpanKind.CLIENT)
            val headers = CallTracing.inject(request.context)
            assertTrue(headers.getValue("traceparent").startsWith("00-11111111111111111111111111111111-"))
            request.end("network_error", failed = true, error = IllegalStateException("secret-token-and-caller-name"))
            answer.end("retry")
            call.finish("cancelled")

            val spans = exporter.finishedSpanItems
            val incoming = spans.single { it.name == "call.incoming" }
            val attempt = spans.single { it.name == "call.answer" }
            val http = spans.single { it.name == "call.ring_status" }
            assertEquals("2222222222222222", incoming.parentSpanId)
            assertEquals(incoming.spanId, attempt.parentSpanId)
            assertEquals(attempt.spanId, http.parentSpanId)
            assertEquals(StatusCode.ERROR, http.status.statusCode)
            assertEquals("IllegalStateException", http.attributes.get(AttributeKey.stringKey("error.type")))
            assertTrue(spans.all { it.traceId == incoming.traceId && it.endEpochNanos >= it.startEpochNanos })
            assertTrue(spans.all { !it.attributes.toString().contains("secret-token-and-caller-name") && it.events.isEmpty() })
        }
    }

    @Test fun resolvingTheCallClosesPendingPhasesExactlyOnce() {
        val exporter = InMemorySpanExporter.create()
        SdkTracerProvider.builder().addSpanProcessor(SimpleSpanProcessor.create(exporter)).build().use { provider ->
            val call = CallTrace(provider.get("test"), "test-call", Context.root())
            val permission = call.phase("call.permission.microphone")
            call.finish("answered_elsewhere")
            permission.end("granted")
            call.finish("connected")
            call.phase("late-callback").end("done")
            assertEquals(2, exporter.finishedSpanItems.size)
            assertTrue(exporter.finishedSpanItems.all {
                it.attributes.get(AttributeKey.stringKey("call.outcome")) == "answered_elsewhere"
            })
        }
    }

    @Test fun malformedPushContextStartsANewTrace() {
        val exporter = InMemorySpanExporter.create()
        SdkTracerProvider.builder().addSpanProcessor(SimpleSpanProcessor.create(exporter)).build().use { provider ->
            val call = CallTrace(provider.get("test"), "test-call", CallTracing.extract(mapOf("traceparent" to "invalid")))
            call.finish("declined")
            assertEquals("0000000000000000", exporter.finishedSpanItems.single().parentSpanId)
            assertNotEquals("00000000000000000000000000000000", exporter.finishedSpanItems.single().traceId)
        }
    }
}
