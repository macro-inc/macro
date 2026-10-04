use crate::domain::service::Service;
/// Durable jobs are leased from Postgres; multiple DSS instances may sweep safely.
pub async fn run(service: Service) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(10));
    loop {
        interval.tick().await;
        if let Err(e) = service.sweep().await {
            tracing::warn!(error=?e,"Support worker sweep failed");
        }
    }
}
