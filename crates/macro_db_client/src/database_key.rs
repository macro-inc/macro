use sqlx::{Pool, Postgres};

/// Which database a pool reads from. Lookups shared between concurrent callers
/// carry it in their key, so a caller on the primary never receives a replica's
/// answer and tests on separate databases never receive each other's.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct DatabaseKey {
    host: String,
    port: u16,
    database: Option<String>,
}

impl DatabaseKey {
    pub(crate) fn of(db: &Pool<Postgres>) -> Self {
        let options = db.connect_options();

        Self {
            host: options.get_host().to_string(),
            port: options.get_port(),
            database: options.get_database().map(str::to_string),
        }
    }
}
