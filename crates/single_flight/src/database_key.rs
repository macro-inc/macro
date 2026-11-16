use std::path::PathBuf;

use sqlx::{Pool, Postgres};

/// Which database a pool reads from, as whom and with which startup options
/// (a `search_path`, for one). Database lookups shared
/// between concurrent callers carry it in their key, so callers on different
/// databases (the primary and a replica, or two test databases) never share a
/// run.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct DatabaseKey {
    host: String,
    port: u16,
    database: Option<String>,
    username: String,
    socket: Option<PathBuf>,
    options: Option<String>,
}

impl DatabaseKey {
    /// The key of the database `pool` connects to.
    pub fn of(pool: &Pool<Postgres>) -> Self {
        let options = pool.connect_options();

        Self {
            host: options.get_host().to_string(),
            port: options.get_port(),
            database: options.get_database().map(str::to_string),
            username: options.get_username().to_string(),
            socket: options.get_socket().cloned(),
            options: options.get_options().map(str::to_string),
        }
    }
}
