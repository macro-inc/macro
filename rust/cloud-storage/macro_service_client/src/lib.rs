use std::future::Future;

pub trait AssertHealth {
    fn assert_health(&self) -> impl Future<Output = Result<(), anyhow::Error>>;
}
