use anyhow::{anyhow, Result};
use jobs_handler::{
    config::{check_env_vars, get_verbose, load_aws_config},
    connection::{get_api_management_client, send_data},
    dynamodb_job::{get_job, update_job_status},
    model::{
        job::{JobId, JobSubmission, UpdateJobStatusInput},
        update::request::JobUpdateHandlerRequestBody,
        ws_response::SuccessResponse,
    },
};

use aws_sdk_apigatewaymanagement::Client as ApiGatewayManagementClient;
use aws_sdk_dynamodb::Client as DynamoDbClient;
use lambda_http::tracing::{info, subscriber::EnvFilter};
use lambda_runtime::{run, service_fn, tracing, Error, LambdaEvent};

async fn handler(
    dynamodb_client: &DynamoDbClient,
    apigateway_client: &ApiGatewayManagementClient,
    event: LambdaEvent<JobUpdateHandlerRequestBody>,
) -> Result<()> {
    let verbose = get_verbose();
    verbose.then(|| info!(event = ?event, "Event info"));

    let body = event.payload;

    let job_id_str = body.job_id;
    let job_id = JobId(job_id_str.as_str());
    let data = body.data;
    let status = body.status;

    let job_data = get_job(dynamodb_client, &job_id).await?;
    match job_data {
        Some(job) => {
            let JobSubmission {
                connection_id,
                request_id,
                event,
                status: _old_status,
                ..
            } = job;
            verbose.then(|| info!(job_id = ?job_id, connection_id = %connection_id, event = %event, "Found job"));

            if let Some(data) = data {
                if let Err(e) = send_data(
                    apigateway_client,
                    &connection_id,
                    SuccessResponse {
                        job_id: &job_id,
                        macro_request_id: &request_id,
                        event: &event,
                        data,
                        ..Default::default()
                    },
                )
                .await
                {
                    return Err(anyhow!("Failed to send data to client: {:?}", e));
                }
            }
            verbose.then(|| info!(job_id = ?job_id, request_id = %request_id, connection_id = %connection_id, event = %event, "Sent data to client"));

            // TODO: validate status update, e.g. doesn't make sense to go from completed to created
            if let Err(e) = update_job_status(
                dynamodb_client,
                &UpdateJobStatusInput {
                    job_id: &job_id,
                    status: &status,
                },
            )
            .await
            {
                return Err(anyhow!("Failed to update job status: {:?}", e));
            }
            verbose.then(|| info!(job_id = ?job_id, status = ?status, "Updated job status"));
        }
        None => {
            return Err(anyhow!("Job not found"));
        }
    }

    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing::subscriber::fmt()
        .with_line_number(true)
        .json()
        .with_env_filter(EnvFilter::from_default_env())
        .with_current_span(true) // Include current span in formatted events
        .with_span_list(false) // Disable nesting all spans
        .flatten_event(true) // Flattens event fields.init();
        .init();

    tracing::trace!("Starting Lambda Handler");

    check_env_vars()?;

    tracing::trace!("Environment variables are set correctly");

    let shared_config = &load_aws_config().await;
    let shared_dynamodb_client = &DynamoDbClient::new(shared_config);

    let shared_api_management_client = &get_api_management_client(shared_config)?;

    let func = service_fn(
        move |event: LambdaEvent<JobUpdateHandlerRequestBody>| async move {
            handler(shared_dynamodb_client, shared_api_management_client, event).await
        },
    );
    run(func).await
}
