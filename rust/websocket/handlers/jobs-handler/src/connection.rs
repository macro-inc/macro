use anyhow::Result;
use aws_config::SdkConfig;
use aws_sdk_apigatewaymanagement::Client as ApiGatewayManagementClient;
use aws_sdk_apigatewaymanagement::{config, primitives::Blob, Client};
use aws_sdk_dynamodb::Client as DynamoDbClient;
use lambda_http::tracing::trace;
use serde_json::Value;

use crate::dynamodb_job::update_job_status;
use crate::model::job::{JobStatus, UpdateJobStatusInput};
use crate::model::post::PostData;
use crate::post::send_to_document_processing_service;
use crate::{
    config::{get_verbose, API_GATEWAY_ENDPOINT_URL, MOCK_ERROR},
    dynamodb_job::add_job,
    model::{
        job::{AddJobInput, JobId},
        ws_response::SuccessResponse,
    },
};

pub async fn send_data<T>(client: &Client, con_id: &str, data: T) -> Result<()>
where
    T: TryInto<Vec<u8>>,
{
    client
        .post_to_connection()
        .connection_id(con_id)
        .data(Blob::new(data.try_into().unwrap_or_default()))
        .send()
        .await?;
    Ok(())
}

pub fn get_api_management_client(config: &SdkConfig) -> Result<Client> {
    let endpoint_url = &*API_GATEWAY_ENDPOINT_URL;
    let api_management_config = config::Builder::from(config)
        .endpoint_url(endpoint_url)
        .build();
    let client = Client::from_conf(api_management_config);
    Ok(client)
}

#[allow(clippy::too_many_arguments)]
pub async fn websocket_handler_helper(
    dynamodb_client: &DynamoDbClient,
    apigateway_client: &ApiGatewayManagementClient,
    http_client: &reqwest::Client,
    event: &str,
    request_data: &Value,
    connection_id: &str,
    user_id: Option<&str>,
    email: Option<&str>,
    job_id: &JobId<'_>,
    request_id: &str,
    document_id: Option<&str>,
) -> Result<()> {
    let verbose = get_verbose();

    verbose.then(|| trace!(job_id = ?job_id, connection_id = %connection_id, event = %event, "Generated Job Input"));

    send_data(
        apigateway_client,
        connection_id,
        SuccessResponse {
            job_id,
            event,
            macro_request_id: request_id,
            data: Value::from("Job ID created".to_string()),
            ..Default::default()
        },
    )
    .await?;

    if *MOCK_ERROR {
        return Err(anyhow::anyhow!("Mock error"));
    }

    let document_id_job_type = if let Some(document_id) = document_id {
        let document_id_job_type = format!("{}-{}", document_id, event);
        Some(document_id_job_type)
    } else {
        Some("NULL".to_string())
    };
    let add_job_input = AddJobInput {
        job_id,
        request_id,
        connection_id,
        user_id,
        email,
        event,
        document_id_job_type: document_id_job_type.as_deref(),
    };
    add_job(dynamodb_client, &add_job_input).await?;

    verbose.then(|| trace!(job_id = ?job_id, connection_id = %connection_id, event = %event, "Added Job Input"));
    send_data(
        apigateway_client,
        connection_id,
        SuccessResponse {
            job_id,
            macro_request_id: request_id,
            event,
            data: Value::from("Job added to jobs table".to_string()),
            ..Default::default()
        },
    )
    .await?;

    send_to_document_processing_service(
        http_client,
        &PostData {
            event,
            job_id,
            user_id,
            email,
            request_id: Some(request_id),
            data: request_data,
        },
    )
    .await?;
    send_data(
        apigateway_client,
        connection_id,
        SuccessResponse {
            job_id,
            event,
            macro_request_id: request_id,
            data: Value::from("Job sent to document processing service".to_string()),
            ..Default::default()
        },
    )
    .await?;

    let status = JobStatus::Submitted;
    update_job_status(
        dynamodb_client,
        &UpdateJobStatusInput {
            job_id,
            status: &status,
        },
    )
    .await?;

    Ok(())
}
