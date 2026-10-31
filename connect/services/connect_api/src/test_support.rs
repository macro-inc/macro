use std::str::FromStr as _;

use sqlx::{
    Connection as _, Executor as _, PgConnection, PgPool,
    postgres::{PgConnectOptions, PgPoolOptions},
};

use crate::outbound::MIGRATOR;

pub struct TestDatabase {
    name: String,
    admin_options: PgConnectOptions,
    pool: PgPool,
}

impl TestDatabase {
    pub async fn new() -> Self {
        #[expect(
            clippy::disallowed_methods,
            reason = "test databases must use the process DATABASE_URL supplied by the test runner"
        )]
        let url =
            std::env::var("DATABASE_URL").expect("DATABASE_URL is required for database tests");
        let options = PgConnectOptions::from_str(&url).unwrap();
        let admin_options = options.clone().database("postgres");
        let name = format!("connect_test_{}", uuid::Uuid::now_v7().simple());
        let mut admin = PgConnection::connect_with(&admin_options).await.unwrap();
        admin
            .execute(format!("CREATE DATABASE {name} WITH TEMPLATE template0").as_str())
            .await
            .unwrap();

        let pool = PgPoolOptions::new().connect_lazy_with(options.database(&name));
        let database = Self {
            name,
            admin_options,
            pool,
        };
        MIGRATOR.run(&database.pool).await.unwrap();
        database
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }
}

impl Drop for TestDatabase {
    fn drop(&mut self) {
        let name = self.name.clone();
        let options = self.admin_options.clone();
        let result = std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            runtime.block_on(async move {
                let mut admin = PgConnection::connect_with(&options).await?;
                admin
                    .execute(format!("DROP DATABASE {name} WITH (FORCE)").as_str())
                    .await?;
                Ok::<(), sqlx::Error>(())
            })
        })
        .join();
        match result {
            Ok(Ok(())) => {}
            other if std::thread::panicking() => {
                eprintln!("test database cleanup failed: {other:?}")
            }
            other => panic!("test database cleanup failed: {other:?}"),
        }
    }
}
