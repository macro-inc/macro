#![allow(unused, reason = "relic from op log on r2")]
use crate::{error::ResultExt, generated::schema::owned::Operation};
use worker::Result;

pub trait OperationIndexStorage {
    /// Retrieves a list of all pending operations
    async fn get_op_log_index(&self) -> Result<Vec<String>>;
    /// Clears all operations in the operation log
    async fn clear_op_log_index(&self) -> Result<()>;
    /// Appends a new operation to the operation log index
    async fn append_op_log_index(&self, id: &str) -> Result<()>;
}

pub trait OperationLogStorage {
    /// Retrieves a single operation from storage
    async fn get_operation(&self, id: &str) -> Result<Operation>;
    /// Stores a single operation in storage
    async fn put_operation(&self, id: &str, operation: Vec<u8>) -> Result<()>;
    /// Retrieves multiple operations from storage
    async fn get_operations(&self, ids: Vec<String>) -> Result<Vec<Operation>>;
}
const OPERATION_LOG_INDEX_KEY: &str = "operation_log_index";

#[cfg(feature = "kv-snapshot-storage")]
mod kv_ops {
    use std::time::Instant;

    use bebop::{Record, SubRecord};

    use crate::storage::backends::durable_kv::DurableKVStorage;

    use super::*;
    impl OperationIndexStorage for DurableKVStorage {
        async fn get_op_log_index(&self) -> Result<Vec<String>> {
            let index = self
                .get::<Vec<String>>(OPERATION_LOG_INDEX_KEY)
                .await
                .unwrap_or_default();
            Ok(index)
        }

        async fn clear_op_log_index(&self) -> Result<()> {
            self.put::<Vec<u8>>(OPERATION_LOG_INDEX_KEY, vec![]).await?;
            Ok(())
        }

        async fn append_op_log_index(&self, id: &str) -> Result<()> {
            let mut index = self
                .get::<Vec<String>>(OPERATION_LOG_INDEX_KEY)
                .await
                .unwrap_or_default();

            index.push(id.to_string());
            self.put(OPERATION_LOG_INDEX_KEY, index).await?;
            Ok(())
        }
    }

    impl OperationLogStorage for DurableKVStorage {
        /// Retrieves a single operation from storage
        async fn get_operation(&self, operation_id: &str) -> Result<Operation> {
            let key = format!("{}/operation_log/{}.op", self.document_id, operation_id);
            let value = self.get::<Vec<u8>>(&key).await?;
            let operation = Operation::deserialize(value.as_slice()).with_context(|| {
                format!("Couldn't deserialize operation with operation_id: [{operation_id}]")
            })?;
            Ok(operation)
        }

        /// Stores a single operation in storage
        async fn put_operation(&self, id: &str, update: Vec<u8>) -> Result<()> {
            let key = format!("{}/operation_log/{}.op", self.document_id, id);
            let timestamp = bebop::Date::from_millis(Instant::now().elapsed().as_millis() as u64);
            let operation = Operation { update, timestamp };
            let mut buf = Vec::with_capacity(operation.serialized_size());
            operation
                .serialize(&mut buf)
                .context("Couldn't serialize operation")?;
            self.put(&key, buf).await?;
            Ok(())
        }
        /// Retrieves multiple operations from storage
        async fn get_operations(&self, ids: Vec<String>) -> Result<Vec<Operation>> {
            let mut operations = Vec::with_capacity(ids.len());
            for id in ids {
                let operation = self.get_operation(&id).await?;
                operations.push(operation);
            }
            Ok(operations)
        }
    }
}

#[cfg(feature = "r2-snapshot-storage")]
mod r2 {

    use std::time::Instant;

    use bebop::{Record, SubRecord};

    use crate::storage::backends::r2::R2Storage;

    use super::*;
    impl OperationLogStorage for R2Storage {
        async fn get_operation(&self, id: &str) -> Result<Operation> {
            // Format of the key is <document_id>/operation_log/<operation_id>
            let key = format!("{}/operation_log/{}.op", self.document_id, id);
            let value = self.get::<Vec<u8>>(&key).await?;
            let operation = Operation::deserialize(value.as_slice()).with_context(|| {
                format!("Couldn't deserialize operation with operation_id: [{id}]")
            })?;
            Ok(operation)
        }

        async fn put_operation(&self, id: &str, update: Vec<u8>) -> Result<()> {
            // Format of the key is <document_id>/operation_log/<operation_id>
            let key = format!("{}/operation_log/{}.op", self.document_id, id);
            // TODO this is always zero????????
            let timestamp = bebop::Date::from_millis(Instant::now().elapsed().as_millis() as u64);
            let operation = Operation { update, timestamp };
            let mut buf = Vec::with_capacity(operation.serialized_size());
            operation
                .serialize(&mut buf)
                .context("Couldn't serialize operation")?;
            self.put(&key, buf).await?;
            Ok(())
        }

        async fn get_operations(&self, ids: Vec<String>) -> Result<Vec<Operation>> {
            let mut operations = Vec::with_capacity(ids.len());
            for id in ids {
                let operation = self.get_operation(&id).await?;
                operations.push(operation);
            }
            Ok(operations)
        }
    }

    impl OperationIndexStorage for R2Storage {
        async fn get_op_log_index(&self) -> Result<Vec<String>> {
            let key = format!("{}/operation_log/index", self.document_id);
            let index = self.get::<Vec<String>>(&key).await.unwrap_or_default();
            Ok(index)
        }

        async fn clear_op_log_index(&self) -> Result<()> {
            let key = format!("{}/operation_log/index", self.document_id);
            self.put::<Vec<u8>>(&key, vec![]).await?;
            Ok(())
        }

        async fn append_op_log_index(&self, id: &str) -> Result<()> {
            let key = format!("{}/operation_log/index", self.document_id);
            let mut index = self.get::<Vec<String>>(&key).await.unwrap_or_default();
            index.push(id.to_string());
            self.put(&key, index).await?;
            Ok(())
        }
    }
}
