use std::{
    convert::Infallible,
    fmt::{Debug, Display},
};
use tracing::error;

pub trait ResultExt<T, E> {
    /// log the error and convert it to a worker::Error
    fn context<C>(self, message: C) -> Result<T, worker::Error>
    where
        C: Display + Send + Sync + 'static;

    fn with_context<C, F>(self, f: F) -> Result<T, worker::Error>
    where
        C: Display + Send + Sync + 'static,
        F: FnOnce() -> C;

    fn unwrap_context<C>(self, message: C) -> T
    where
        C: Display + Send + Sync + 'static;
}

impl<T, E: Debug> ResultExt<T, E> for Result<T, E> {
    fn context<C>(self, message: C) -> Result<T, worker::Error>
    where
        C: Display + Send + Sync + 'static,
    {
        self.map_err(|err| {
            error!(err=?err, "{message}");
            worker::Error::from(format!("{message} : {err:?}"))
        })
    }
    fn with_context<C, F>(self, f: F) -> Result<T, worker::Error>
    where
        C: Display + Send + Sync + 'static,
        F: FnOnce() -> C,
    {
        self.map_err(|err| {
            let message = f();
            error!(err=?err, "{}", message);
            worker::Error::from(format!("{message} : {err:?}"))
        })
    }
    fn unwrap_context<C>(self, message: C) -> T
    where
        C: Display + Send + Sync + 'static,
    {
        match self {
            Ok(x) => x,
            Err(err) => {
                error!(err=?err, "{}", message);
                panic!("Called `unwrap_context` on an `Err` value");
            }
        }
    }
}
impl<T> ResultExt<T, Infallible> for Option<T> {
    fn context<C>(self, message: C) -> Result<T, worker::Error>
    where
        C: Display + Send + Sync + 'static,
    {
        match self {
            None => {
                error!("{message}");
                Err(worker::Error::from(format!("{message}")))
            }
            Some(x) => Ok(x),
        }
    }
    fn with_context<C, F>(self, f: F) -> Result<T, worker::Error>
    where
        C: Display + Send + Sync + 'static,
        F: FnOnce() -> C,
    {
        match self {
            Some(x) => Ok(x),
            None => {
                let message = f();
                error!("{}", message);
                Err(worker::Error::from(format!("{message}")))
            }
        }
    }
    fn unwrap_context<C>(self, message: C) -> T
    where
        C: Display + Send + Sync + 'static,
    {
        match self {
            Some(x) => x,
            None => {
                error!("{}", message);
                panic!("Called `unwrap_context` on an `None` value");
            }
        }
    }
}
