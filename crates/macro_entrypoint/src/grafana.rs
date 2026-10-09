//! Failure isolation for the optional Grafana trace copy.

use opentelemetry_sdk::{
    Resource,
    error::OTelSdkResult,
    trace::{SpanData, SpanExporter},
};
use std::time::Duration;

/// Drops failed optional copies without producing SDK application-error logs in Datadog.
#[derive(Debug)]
pub(crate) struct GrafanaSpanExporter(pub(crate) opentelemetry_otlp::SpanExporter);

impl SpanExporter for GrafanaSpanExporter {
    async fn export(&self, batch: Vec<SpanData>) -> OTelSdkResult {
        // The inner exporter has a two-second timeout. Returning its failure would
        // make BatchSpanProcessor log ERROR through the application's Datadog sink.
        let _ = self.0.export(batch).await;
        Ok(())
    }

    fn set_resource(&mut self, resource: &Resource) {
        self.0.set_resource(resource);
    }

    fn shutdown_with_timeout(&mut self, timeout: Duration) -> OTelSdkResult {
        let _ = self.0.shutdown_with_timeout(timeout);
        Ok(())
    }

    fn force_flush(&mut self) -> OTelSdkResult {
        let _ = self.0.force_flush();
        Ok(())
    }
}
