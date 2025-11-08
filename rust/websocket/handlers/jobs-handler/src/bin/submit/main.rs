use anyhow::{anyhow, Context, Result};
use jobs_handler::{
    config::{check_env_vars, load_aws_config, MAXIMUM_JOB_DURATION_TIME_MINUTES},
    connection::{get_api_management_client, send_data, websocket_handler_helper},
    dynamodb_connnection::get_connection,
    dynamodb_job::{check_for_running_job, generate_job_id},
    model::{
        job::JobId, submit::request::JobSubmissionHandlerRequestBody, ws_response::ErrorResponse,
    },
};

use aws_sdk_apigatewaymanagement::Client as ApiGatewayManagementClient;
use aws_sdk_dynamodb::Client as DynamoDbClient;
use lambda_http::{
    http::StatusCode,
    request::RequestContext,
    run, service_fn,
    tracing::{self, subscriber::EnvFilter},
    Body, Error, Request, RequestExt, Response,
};

async fn handler(
    dynamodb_client: &DynamoDbClient,
    apigateway_client: &ApiGatewayManagementClient,
    http_client: &reqwest::Client,
    event: Request,
) -> Result<Response<Body>> {
    tracing::trace!(event=?event, "event info");

    match event.request_context() {
        RequestContext::WebSocket(ws_context) => 'outer: {
            let connection_id = ws_context
                .connection_id
                .with_context(|| "failed to get connection id".to_string())?;

            tracing::trace!(connection_id=?connection_id, "Got connection id");

            let body = match serde_json::from_slice::<JobSubmissionHandlerRequestBody>(event.body())
            {
                Ok(body) => body,
                Err(e) => {
                    tracing::error!(error=?e, "failed to parse request body");
                    send_data(
                        apigateway_client,
                        &connection_id,
                        ErrorResponse {
                            request_body: Some(serde_json::json!(event.body())),
                            error: format!("Failed to parse request body: {:?}", e),
                            ..Default::default()
                        },
                    )
                    .await?;
                    break 'outer;
                }
            };

            let action = body.action;
            let request_data = body.data;
            let request_id = body.request_id;

            tracing::trace!(request_id=?request_id, action=?action, "got request");

            // Get connection information from websocket connection table
            let websocket_connection = match get_connection(dynamodb_client, connection_id.as_str())
                .await
            {
                Ok(connection) => connection,
                Err(e) => {
                    tracing::error!(connection_id=?connection_id, error=?e, "failed to get connection");
                    return Err(e);
                }
            };

            // If we are unable to get the websocket connection from dynamdodb, we should return an
            // error
            if websocket_connection.is_none() {
                tracing::error!(connection_id=?connection_id, "connection not found");
                send_data(
                    apigateway_client,
                    &connection_id,
                    ErrorResponse {
                        macro_request_id: Some(&request_id),
                        event: Some(&action),
                        error: "Unauthorized".to_string(),
                        ..Default::default()
                    },
                )
                .await?;
                break 'outer;
            }

            tracing::trace!(
                request_id=?request_id,
                action=?action,
                websocket_connection=?websocket_connection,
                "websocket connection found",
            );

            let user_id = websocket_connection
                .as_ref()
                .and_then(|c| c.user_id.as_deref());

            let email = websocket_connection
                .as_ref()
                .and_then(|c| c.email.as_deref());

            let document_id = request_data.get("documentId").and_then(|v| v.as_str());

            if let Some(document_id) = document_id {
                let document_id_job_type = format!("{document_id}-{action}");

                tracing::trace!(document_id_job_type=?document_id_job_type, "looking for existing job");
                let (job_exists, job_request_time) = match check_for_running_job(
                    dynamodb_client,
                    &document_id_job_type,
                )
                .await
                {
                    Ok(request) => request,
                    Err(e) => {
                        tracing::error!(document_id_job_type=?document_id_job_type, error=?e, "failed to check for running job");
                        (false, None)
                    }
                };

                if job_exists {
                    tracing::trace!(document_id_job_type=?document_id_job_type, "job already exists");

                    // Check if the request time is > MAXIMUM_JOB_DURATION_TIME_MINUTES. If so, the job is stale and
                    // should be restarted
                    if let Some(job_request_time) = job_request_time {
                        // If the present time - request time is within MAXIMUM_JOB_DURATION_TIME_MINUTES minutes, the job is still in progress
                        let job_running_time =
                            chrono::Utc::now().signed_duration_since(job_request_time);
                        if job_running_time
                            < chrono::Duration::minutes(*MAXIMUM_JOB_DURATION_TIME_MINUTES)
                        {
                            tracing::trace!(document_id_job_type=?document_id_job_type, "job is still in progres");
                            // If retry: true is in the request body data, then we should retry as long
                            // as the job has been running for >= 3 minutes
                            let retry: bool = request_data
                                .get("retry")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);

                            if retry {
                                // Retry is true
                                tracing::trace!(document_id_job_type=?document_id_job_type, "potentially retrying job");
                                // We allow a job to be retried if it was been running for at least
                                // 3 minutes
                                if job_running_time < chrono::Duration::minutes(3) {
                                    tracing::info!(document_id_job_type=?document_id_job_type, "job cannot be retried yet");
                                    send_data(
                                        apigateway_client,
                                        &connection_id,
                                        ErrorResponse {
                                            macro_request_id: Some(&request_id),
                                            event: Some(&action),
                                            error: "Job cannot be retried yet".to_string(),
                                            ..Default::default()
                                        },
                                    )
                                    .await?;
                                    // Break outer because we don't want to continue processing the request
                                    break 'outer;
                                }
                            } else {
                                // Retry is false, so we treat the job as still in progress
                                send_data(
                                    apigateway_client,
                                    &connection_id,
                                    ErrorResponse {
                                        macro_request_id: Some(&request_id),
                                        event: Some(&action),
                                        error: "Job already running".to_string(),
                                        ..Default::default()
                                    },
                                )
                                .await?;
                                // Break outer because we don't want to continue processing the request
                                break 'outer;
                            }
                        } else {
                            tracing::trace!(document_id_job_type=?document_id_job_type, "job is stale, continue processing request");
                        }
                    }
                }
            }

            let job_id_str = generate_job_id();
            let job_id = JobId(job_id_str.as_str());

            if let Err(e) = websocket_handler_helper(
                dynamodb_client,
                apigateway_client,
                http_client,
                &action,
                &request_data,
                &connection_id,
                user_id,
                email,
                &job_id,
                &request_id,
                document_id,
            )
            .await
            {
                tracing::error!(request_id=?request_id, action=?action, error=?e, "failed to send data to client");
                send_data(
                    apigateway_client,
                    &connection_id,
                    ErrorResponse {
                        job_id: Some(&job_id),
                        macro_request_id: Some(&request_id),
                        event: Some(&action),
                        error: format!("{:?}", e),
                        ..Default::default()
                    },
                )
                .await?;
                break 'outer;
            }
        }
        _ => {
            return Err(anyhow!("invalid request context"));
        }
    };

    Ok(Response::builder()
        .status(StatusCode::OK)
        .body(Body::Empty)
        .expect("failed to render response"))
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

    tracing::trace!("starting lambda handler");

    check_env_vars()?;

    tracing::trace!("environment variables are set correctly");

    let shared_config = &load_aws_config().await;
    let shared_dynamodb_client = &DynamoDbClient::new(shared_config);

    let shared_api_management_client = &get_api_management_client(shared_config)?;

    let http_client = &reqwest::Client::builder().use_rustls_tls().build().unwrap();

    let func = service_fn(move |event: Request| async move {
        handler(
            shared_dynamodb_client,
            shared_api_management_client,
            http_client,
            event,
        )
        .await
    });
    run(func).await
}

#[cfg(test)]
mod tests {
    /// Test used to validate the time check logic we have to see if a job is stale and we should
    /// allow a new one to start or not
    #[test]
    fn test_time_check() {
        let now = chrono::Utc::now();
        // job request time is 31 minutes in the past
        let job_request_time = now - chrono::Duration::minutes(31);

        // Time should be > 30 minutes
        assert!(now.signed_duration_since(job_request_time) > chrono::Duration::minutes(30));
        // job request time is 10 minutes in the past
        let job_request_time = now - chrono::Duration::minutes(10);
        assert!(now.signed_duration_since(job_request_time) < chrono::Duration::minutes(30));
    }
}
