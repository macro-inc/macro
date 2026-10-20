// Package telemetry connects control/worker spans without capturing protocol data.
package telemetry

import (
	"context"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
	"log/slog"
	"os"
)

func Init(ctx context.Context) (func(context.Context) error, error) {
	exporter, err := otlptracehttp.New(ctx)
	if err != nil {
		return nil, err
	}
	provider := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exporter), sdktrace.WithResource(resource.NewSchemaless(attribute.String("service.name", "whatsapp-session"))))
	otel.SetTracerProvider(provider)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	return provider.Shutdown, nil
}

// Event fields are deliberately fixed: opaque Macro IDs, counts and safe category.
func Event(ctx context.Context, category, account, operation string, count int) {
	slog.InfoContext(ctx, category, "account_id", account, "operation_id", operation, "count", count, "trace_id", trace.SpanContextFromContext(ctx).TraceID().String())
}
func Start(ctx context.Context, name, account, operation string) (context.Context, trace.Span) {
	return otel.Tracer("macro/whatsapp-session").Start(ctx, name, trace.WithAttributes(attribute.String("account.id", account), attribute.String("operation.id", operation)))
}
