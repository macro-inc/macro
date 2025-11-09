use thiserror::Error;

pub trait Logger {
    fn log_err(self) -> Self;
    fn log_and_consume(self);
}

impl<T, E> Logger for Result<T, E>
where
    E: std::error::Error,
{
    fn log_err(self) -> Self {
        match &self {
            Ok(_) => {}
            Err(e) => tracing::error!("{e}"),
        }

        self
    }

    fn log_and_consume(self) {
        self.log_err().ok();
    }
}

#[derive(Debug, Error)]
#[error("Context err: {0}")]
pub struct ContextErr(&'static str);

pub trait Context<T> {
    fn context(self, s: &'static str) -> Result<T, ContextErr>;
}

impl<T> Context<T> for Option<T> {
    fn context(self, s: &'static str) -> Result<T, ContextErr> {
        self.ok_or_else(|| ContextErr(s))
    }
}
