use super::model::DeleteError;
use anyhow::Result;
use aws_sdk_dynamodb::Client;
use aws_sdk_dynamodb::error::SdkError;
use aws_sdk_dynamodb::operation::delete_item::DeleteItemError::ResourceNotFoundException;
use aws_sdk_dynamodb::types::AttributeValue;

pub async fn delete_item(client: &Client, table: &str, id: &str) -> Result<(), DeleteError> {
    match client
        .delete_item()
        .table_name(table)
        .key("file_id", AttributeValue::S(id.to_owned()))
        .send()
        .await
    {
        Ok(_) => Ok(()),
        Err(SdkError::ServiceError(e)) => {
            if let ResourceNotFoundException(e) = e.err() {
                Err(DeleteError::NotFound(e.to_string()))
            } else {
                Err(DeleteError::Other(e.into_err().to_string()))
            }
        }
        Err(e) => Err(DeleteError::Other(e.to_string())),
    }
}
