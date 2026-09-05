mod get_sha_count;

#[allow(unused_imports)]
use mockall::automock;

#[cfg(not(test))]
pub use DBClient as DB;
#[cfg(test)]
pub use MockDBClient as DB;

#[derive(Clone)]
pub struct DBClient {
    inner: sqlx::Pool<sqlx::Postgres>,
}

#[cfg_attr(test, automock)]
impl DBClient {
    pub fn new(inner: sqlx::Pool<sqlx::Postgres>) -> Self {
        Self { inner }
    }

    pub async fn get_sha_count(&self, sha: &str) -> anyhow::Result<i64> {
        get_sha_count::get_sha_count(self.inner.clone(), sha).await
    }
}

#[cfg(test)]
mod tests {
    use mockall::predicate::eq;

    use crate::service::db::DB;

    #[tokio::test]
    async fn test_get_sha_count() {
        let mut mock = DB::default();
        mock.expect_get_sha_count()
            .with(eq("sha"))
            .return_once(|_| Ok(0));

        let result = mock.get_sha_count("sha").await;

        assert_eq!(result.is_ok(), true);
    }
}
