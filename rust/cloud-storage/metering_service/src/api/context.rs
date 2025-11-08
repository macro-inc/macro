use axum::extract::FromRef;
use metering_db_client::MeteringDb;

#[derive(Debug, Clone, FromRef)]
pub struct ApiContext {
    pub db: MeteringDb,
}
