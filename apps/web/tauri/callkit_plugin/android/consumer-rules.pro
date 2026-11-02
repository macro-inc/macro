# OTLP discovers its HTTP transport through META-INF/services at runtime.
-keep class io.opentelemetry.exporter.sender.okhttp.internal.OkHttpHttpSenderProvider { *; }
