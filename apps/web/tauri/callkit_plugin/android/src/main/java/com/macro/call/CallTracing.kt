package com.macro.call

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import io.opentelemetry.api.common.Attributes
import io.opentelemetry.api.trace.Span
import io.opentelemetry.api.trace.SpanKind
import io.opentelemetry.api.trace.StatusCode
import io.opentelemetry.api.trace.Tracer
import io.opentelemetry.api.trace.propagation.W3CTraceContextPropagator
import io.opentelemetry.context.Context as TraceContext
import io.opentelemetry.context.propagation.TextMapGetter
import io.opentelemetry.context.propagation.TextMapSetter
import io.opentelemetry.exporter.otlp.http.trace.OtlpHttpSpanExporter
import io.opentelemetry.sdk.resources.Resource
import io.opentelemetry.sdk.trace.SdkTracerProvider
import io.opentelemetry.sdk.trace.export.BatchSpanProcessor
import java.net.URI
import java.util.concurrent.TimeUnit

/** Native spans use the same exporter and enablement decision as browser telemetry, retained for cold calls. */
internal object CallTracing {
    private var provider: SdkTracerProvider? = null
    private var initialized = false
    private val propagator = W3CTraceContextPropagator.getInstance()
    private val getter = object : TextMapGetter<Map<String, String>> {
        override fun keys(carrier: Map<String, String>) = carrier.keys
        override fun get(carrier: Map<String, String>?, key: String) = carrier?.get(key)
    }
    private val setter = TextMapSetter<MutableMap<String, String>> { carrier, key, value -> carrier?.put(key, value); Unit }

    @Synchronized fun configure(context: Context, tracesUrl: String?, environment: String) {
        if (tracesUrl != null) {
            val uri = URI(tracesUrl)
            val cleartextDebug = context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0 && uri.scheme == "http"
            require((uri.scheme == "https" || cleartextDebug) && uri.host != null && uri.userInfo == null && uri.fragment == null)
            require(uri.path.endsWith("/v1/traces") && environment.isNotBlank())
        }
        val settings = context.getSharedPreferences("macro_call_tracing", Context.MODE_PRIVATE)
        if (settings.getString("url", null) == tracesUrl && settings.getString("environment", null) == environment) return
        Calls.stopTracing(if (tracesUrl == null) "telemetry_disabled" else "telemetry_reconfigured")
        settings.edit()
            .putString("url", tracesUrl).putString("environment", environment).apply()
        provider?.shutdown()
        provider = null; initialized = false
    }

    @Synchronized fun start(context: Context, offer: CallOffer): CallTrace? {
        if (!initialized) {
            initialized = true
            val settings = context.getSharedPreferences("macro_call_tracing", Context.MODE_PRIVATE)
            val url = settings.getString("url", null) ?: return null
            val environment = settings.getString("environment", null) ?: return null
            provider = runCatching {
                val exporter = OtlpHttpSpanExporter.builder().setEndpoint(url).setTimeout(3, TimeUnit.SECONDS).build()
                SdkTracerProvider.builder().setResource(Resource.getDefault().merge(Resource.create(Attributes.builder()
                    .put("service.name", "android-calls")
                    .put("deployment.environment", environment)
                    .put("service.version", context.packageManager.getPackageInfo(context.packageName, 0).versionName.orEmpty())
                    .put("app.platform", "android").build())))
                    .addSpanProcessor(BatchSpanProcessor.builder(exporter).setScheduleDelay(1, TimeUnit.SECONDS)
                        .setMaxQueueSize(512).build()).build()
            }.getOrElse {
                android.util.Log.w("MacroCall", "Native call tracing initialization failed: ${it.javaClass.simpleName}")
                null
            }
        }
        val active = provider ?: return null
        return CallTrace(active.get("macro.calls"), offer.callId,
            extract(mapOf("traceparent" to offer.traceparent.orEmpty(), "tracestate" to offer.tracestate.orEmpty()))) {
            active.forceFlush()
        }
    }

    fun extract(carrier: Map<String, String>): TraceContext =
        propagator.extract(TraceContext.root(), carrier, getter)

    fun inject(context: TraceContext): Map<String, String> = mutableMapOf<String, String>().also {
        propagator.inject(context, it, setter)
    }
}

/** One incoming-call trace; explicit contexts avoid leaking an ambient scope across coroutine threads. */
internal class CallTrace(tracer: Tracer, val callId: String, parent: TraceContext, private val flush: () -> Unit = {}) {
    private val tracer = tracer
    private val root = tracer.spanBuilder("call.incoming").setParent(parent).setSpanKind(SpanKind.CONSUMER)
        .setAttribute("call.id", callId).startSpan()
    val context: TraceContext = TraceContext.root().with(root)
    private var finished = false
    private val phases = mutableSetOf<Phase>()

    @Synchronized fun phase(name: String, parent: TraceContext = context, kind: SpanKind = SpanKind.INTERNAL): Phase {
        // A late completion stays a no-op after the call has resolved.
        val span = if (finished) Span.getInvalid() else tracer.spanBuilder(name).setParent(parent)
            .setSpanKind(kind).setAttribute("call.id", callId).startSpan()
        return Phase(span).also { if (!finished) phases.add(it) }
    }

    fun write(intent: Intent) {
        CallTracing.inject(context).forEach { (key, value) -> intent.putExtra(key, value) }
    }

    fun activity(intent: Intent): Phase {
        val parent = CallTracing.extract(mapOf("traceparent" to intent.getStringExtra("traceparent").orEmpty(),
            "tracestate" to intent.getStringExtra("tracestate").orEmpty()))
        val matching = Span.fromContext(parent).spanContext.traceId == root.spanContext.traceId
        return phase("call.activity", if (matching) parent else context)
    }

    @Synchronized fun finish(outcome: String, failed: Boolean = false) {
        if (finished) return
        finished = true
        phases.toList().forEach { it.end(outcome, failed) }
        root.setAttribute("call.outcome", outcome)
        if (failed) root.setStatus(StatusCode.ERROR)
        root.end()
        flush()
    }

    inner class Phase internal constructor(private val span: Span) {
        val context: TraceContext = TraceContext.root().with(span)
        private var ended = false
        fun attribute(key: String, value: String) { synchronized(this@CallTrace) { if (!ended) span.setAttribute(key, value) } }
        fun attribute(key: String, value: Boolean) { synchronized(this@CallTrace) { if (!ended) span.setAttribute(key, value) } }
        fun attribute(key: String, value: Long) { synchronized(this@CallTrace) { if (!ended) span.setAttribute(key, value) } }
        // Exceptions can contain LiveKit URLs/JWTs; record only the exception class.
        fun end(outcome: String, failed: Boolean = false, error: Throwable? = null) {
            synchronized(this@CallTrace) {
                if (ended) return
                ended = true
                span.setAttribute("call.outcome", outcome)
                error?.let { span.setAttribute("error.type", it.javaClass.simpleName) }
                if (failed) span.setStatus(StatusCode.ERROR)
                span.end(); phases.remove(this)
            }
        }
    }
}
