//! Postgres connections that name the service in `pg_stat_activity`.

use std::future::Future;

use sqlx::PgPool;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};

/// Options for `url` whose sessions report `<service>:<pool>` as their
/// `application_name`, so database-side tools can attribute load to a
/// service and pool. An `application_name` from the URL or `PGAPPNAME` wins.
pub fn pg_connect_options(url: &str, pool: &str) -> Result<PgConnectOptions, sqlx::Error> {
    let options: PgConnectOptions = url.parse()?;
    if options.get_application_name().is_some() {
        return Ok(options);
    }
    Ok(options.application_name(&application_name(&crate::service_name(), pool)))
}

/// Postgres keeps the first 63 bytes of `application_name`.
fn application_name(service: &str, pool: &str) -> String {
    let mut name = format!("{service}:{pool}");
    let mut end = name.len().min(63);
    while !name.is_char_boundary(end) {
        end -= 1;
    }
    name.truncate(end);
    name
}

/// Connects pools with [`pg_connect_options`].
pub trait PgPoolOptionsExt {
    /// Connects to `url`, naming the sessions after this service and `pool`.
    fn connect_as(
        self,
        url: &str,
        pool: &str,
    ) -> impl Future<Output = Result<PgPool, sqlx::Error>> + Send;

    /// Creates a lazy pool for `url`, naming its sessions after this service
    /// and `pool`.
    fn connect_lazy_as(self, url: &str, pool: &str) -> Result<PgPool, sqlx::Error>;
}

impl PgPoolOptionsExt for PgPoolOptions {
    fn connect_as(
        self,
        url: &str,
        pool: &str,
    ) -> impl Future<Output = Result<PgPool, sqlx::Error>> + Send {
        let options = pg_connect_options(url, pool);
        async move { self.connect_with(options?).await }
    }

    fn connect_lazy_as(self, url: &str, pool: &str) -> Result<PgPool, sqlx::Error> {
        Ok(self.connect_lazy_with(pg_connect_options(url, pool)?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_service_and_pool() {
        assert_eq!(
            application_name("document-storage-service", "readonly"),
            "document-storage-service:readonly"
        );
    }

    #[test]
    fn keeps_the_name_within_postgres_limit() {
        let name = application_name(&"é".repeat(40), "primary");
        assert!(name.len() <= 63);
        assert!(name.starts_with('é'));
    }

    #[test]
    fn url_application_name_wins() {
        let options = pg_connect_options(
            "postgres://u:p@localhost/db?application_name=explicit",
            "primary",
        )
        .unwrap();
        assert_eq!(options.get_application_name(), Some("explicit"));
    }
}
