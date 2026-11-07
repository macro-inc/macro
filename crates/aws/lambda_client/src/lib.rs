mod invoke;

#[derive(Clone, Debug)]
pub struct Lambda {
    /// Inner Lambda client
    inner: aws_sdk_lambda::Client,
}

impl Lambda {
    pub fn new(inner: aws_sdk_lambda::Client) -> Self {
        Self { inner }
    }

    /// Executes the lambda as an event.
    /// It does not wait for the response.
    #[tracing::instrument(skip(self))]
    pub async fn invoke_event<T>(&self, function_name: &str, invoke_args: &T) -> anyhow::Result<()>
    where
        T: serde::Serialize + std::fmt::Debug,
    {
        invoke::invoke_event(&self.inner, function_name, &invoke_args).await
    }
}
