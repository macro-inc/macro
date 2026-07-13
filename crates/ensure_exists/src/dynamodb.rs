use crate::EnsureExists;
use aws_sdk_dynamodb::{error::SdkError, operation::describe_table::DescribeTableError};
use std::time::Duration;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CreateTableErr {
    #[error(transparent)]
    AwsErr(#[from] aws_sdk_dynamodb::Error),
    #[error("An unknown error occurred {0:?}")]
    OtherErr(anyhow::Error),
}

/// trait for defining the structure of a to-be-created table in dynamodb
/// if a table name implements this trait then a blanket impl is provided for [EnsureExists] on [DynamoClientWrapper]
pub trait DefineTable: AsRef<str> + Clone + std::fmt::Debug {
    /// perform the table creation with the dynamo sdk
    fn create_table(
        &self,
        client: &aws_sdk_dynamodb::Client,
    ) -> impl Future<Output = Result<(), CreateTableErr>>;
}

/// A simple wrapper around [aws_sdk_dynamodb::Client] for implementing methods on
pub struct DynamoClientWrapper<'a, T> {
    /// the client to communicate with
    pub client: &'a aws_sdk_dynamodb::Client,
    /// the name of the table to transact with
    pub table_name: T,
}

impl<'a, T> DynamoClientWrapper<'a, T>
where
    T: DefineTable,
{
    /// Wait for the table to become active after creation.
    #[tracing::instrument(err, ret, skip(self))]
    async fn wait_for_table_active(&self) -> Result<(), DynamoDbTableErr> {
        use aws_sdk_dynamodb::types::TableStatus;
        use std::time::Duration;
        use tokio::time::sleep;

        let mut attempts = 0;
        const MAX_ATTEMPTS: u32 = 30;
        const WAIT_DURATION: Duration = Duration::from_secs(2);

        loop {
            let describe_result = self
                .client
                .describe_table()
                .table_name(self.table_name.as_ref())
                .send()
                .await
                .map_err(aws_sdk_dynamodb::Error::from)?;

            if let Some(table) = describe_result.table
                && let Some(status) = table.table_status
                && status == TableStatus::Active
            {
                return Ok(());
            }

            attempts += 1;
            if attempts >= MAX_ATTEMPTS {
                return Err(DynamoDbTableErr::Timeout(MAX_ATTEMPTS * WAIT_DURATION));
            }

            sleep(WAIT_DURATION).await;
        }
    }
}

#[derive(Debug, Error)]
pub enum DynamoDbTableErr {
    #[error("An error occurred with dynamodb {0:?}")]
    ClientErr(#[from] aws_sdk_dynamodb::Error),
    #[error("An unknown error has occurred {0:?}")]
    UnknownError(anyhow::Error),
    #[error("Exceed timeout waiting for table to become active. Waited {0:?}")]
    Timeout(Duration),
}

impl<'a, T> EnsureExists<T> for DynamoClientWrapper<'a, T>
where
    T: DefineTable,
{
    type Err = DynamoDbTableErr;

    #[tracing::instrument(err, ret, skip(self))]
    async fn check_exists(&self) -> Result<Option<T>, Self::Err> {
        match self
            .client
            .describe_table()
            .table_name(self.table_name.as_ref())
            .send()
            .await
        {
            Ok(_) => Ok(Some(self.table_name.clone())),
            Err(SdkError::ServiceError(service_err))
                if matches!(
                    service_err.err(),
                    DescribeTableError::ResourceNotFoundException(_)
                ) =>
            {
                Ok(None)
            }
            Err(e) => Err(DynamoDbTableErr::ClientErr(e.into())),
        }
    }

    async fn create_if_not_exists(&self) -> Result<T, Self::Err> {
        T::create_table(&self.table_name, self.client)
            .await
            .map_err(|e| match e {
                CreateTableErr::AwsErr(error) => DynamoDbTableErr::ClientErr(error),
                CreateTableErr::OtherErr(e) => DynamoDbTableErr::UnknownError(e),
            })?;

        // Wait for table to become active
        self.wait_for_table_active().await?;

        Ok(self.table_name.clone())
    }
}
