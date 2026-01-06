pub trait Logger {
    fn log_err(self) -> Self;
    fn log_and_consume(self);
}

impl<T, E> Logger for Result<T, E>
where
    E: std::fmt::Display,
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
