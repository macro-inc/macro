use std::borrow::Cow;

use anyhow::{Context, Result};
use aws_sdk_dynamodb::{types::AttributeValue, Client};
use chrono::Utc;
use lambda_http::tracing::{self};
use serde_dynamo::to_item;

use crate::{
    config::{JOB_SUBMISSION_EXPIRATION_MINUTES, JOB_SUBMISSION_TABLE_NAME},
    model::job::{
        AddJobInput, JobId, JobStatus, JobSubmission, JobSubmissionsTableKey, UpdateJobStatusInput,
    },
};

pub fn generate_job_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Returns a tuple of (is_running, request_time)
#[tracing::instrument(skip(dynamodb_client))]
pub async fn check_for_running_job(
    dynamodb_client: &Client,
    document_id_job_type: &str,
) -> Result<(bool, Option<chrono::DateTime<chrono::Utc>>)> {
    let table_name = &*JOB_SUBMISSION_TABLE_NAME;
    let gsi_name = "DocumentIdJobTypeIndex"; // Replace with your GSI name if different

    tracing::trace!(document_id_job_type=?document_id_job_type, "checking for running job");
    let query_result = dynamodb_client
        .query()
        .table_name(table_name)
        .index_name(gsi_name)
        .key_condition_expression("#documentIdJobType = :documentIdJobType")
        .expression_attribute_names("#documentIdJobType", "DocumentIdJobType")
        .expression_attribute_values(
            ":documentIdJobType",
            AttributeValue::S(document_id_job_type.to_string()),
        )
        .limit(1)
        .send()
        .await?;

    // `ExpiresAtSeconds` field is a number that is stored as a timestamp in the format `1729183935`

    if let Some(items) = query_result.items {
        // If there are no items we can return early
        if items.is_empty() {
            tracing::trace!(document_id_job_type=?document_id_job_type, "no existing job found");
            return Ok((false, None));
        }

        tracing::trace!(document_id_job_type=?document_id_job_type, "found existing job");

        if let Some(job_status_attr) = items[0].get("Status") {
            let job_status = job_status_attr.as_s().map_err(|_| {
                    tracing::error!(document_id_job_type=?document_id_job_type, job_status=?job_status_attr, "failed to parse job status attribute as string");
                    anyhow::anyhow!("failed to parse job status attribute as string")
                })?;
            tracing::trace!(document_id_job_type=?document_id_job_type, job_status=?job_status, "found existing job with status");
            // If the job status is completed or failed, there is no job running
            if job_status == "Completed" || job_status == "Failed" {
                return Ok((false, None));
            } else {
                // There is a job running with a non-complete status
                // we need to check if the job is expired
                let mut job_request_time: Option<chrono::DateTime<chrono::Utc>> = None;
                if let Some(request_time_attr) = items[0].get("RequestTime") {
                    let request_time = request_time_attr.as_s().map_err(|e| {
                        anyhow::anyhow!("Failed to parse request_time attribute as string: {:?}", e)
                    })?;
                    tracing::trace!(document_id_job_type=%document_id_job_type, request_time=?request_time, "found existing job with request_time");
                    job_request_time = Some(
                        chrono::DateTime::parse_from_rfc3339(request_time)
                            .context("expected to be able to parse request_time")?
                            .with_timezone(&chrono::Utc),
                    );
                }

                return Ok((true, job_request_time));
            }
        }
    }

    Ok((false, None))
}

pub async fn add_job(dynamodb_client: &Client, input: &AddJobInput<'_>) -> Result<()> {
    let job_id = input.job_id;
    let request_id = input.request_id;
    let connection_id = input.connection_id;
    let user_id = input.user_id;
    let email = input.email;
    let event = input.event;
    let document_id_job_type = input.document_id_job_type;

    let request_time = Utc::now();
    let expiration_minutes = *JOB_SUBMISSION_EXPIRATION_MINUTES;
    let expires_at =
        expiration_minutes.map(|minutes| request_time + chrono::Duration::minutes(minutes));

    let table_name = &*JOB_SUBMISSION_TABLE_NAME;
    let job_submission = JobSubmission {
        job_id: Cow::Borrowed(job_id.0),
        request_id: Cow::Borrowed(request_id),
        connection_id: Cow::Borrowed(connection_id),
        user_id: user_id.map(Cow::Borrowed),
        email: email.map(Cow::Borrowed),
        request_time,
        event: Cow::Borrowed(event),
        status: JobStatus::Created,
        document_id_job_type: document_id_job_type.map(Cow::Borrowed),
        expires_at_seconds: expires_at,
    };
    let item = to_item(&job_submission)?;
    dynamodb_client
        .put_item()
        .set_table_name(Some(table_name.to_string()))
        .set_item(Some(item))
        .send()
        .await?;
    Ok(())
}

pub async fn update_job_status(
    dynamodb_client: &Client,
    input: &UpdateJobStatusInput<'_>,
) -> Result<()> {
    let job_id = input.job_id;
    let status = &input.status;

    let key = to_item(&JobSubmissionsTableKey { job_id })?;
    let status_attribute_value = AttributeValue::S(format!("{:?}", status));

    tracing::info!(job_id=?job_id, key=?key, update_item=?status_attribute_value, "Updating job status");

    let table_name = &*JOB_SUBMISSION_TABLE_NAME;
    dynamodb_client
        .update_item()
        .table_name(table_name)
        .set_key(Some(key))
        .update_expression("SET #status = :status")
        .expression_attribute_names("#status", "Status")
        .expression_attribute_values(":status", status_attribute_value)
        .send()
        .await?;
    Ok(())
}

pub async fn get_job<'a>(
    dynamodb_client: &Client,
    job_id: &JobId<'a>,
) -> Result<Option<JobSubmission<'a>>> {
    let key = to_item(&JobSubmissionsTableKey { job_id })?;

    tracing::info!(job_id=?job_id, key=?key, "Getting job");

    let table_name = &*JOB_SUBMISSION_TABLE_NAME;
    let res = dynamodb_client
        .get_item()
        .table_name(table_name)
        .set_key(Some(key))
        .send()
        .await?;

    let item = res.item;
    let job_submission = match item {
        Some(item) => serde_dynamo::from_item(item)?,
        None => return Ok(None),
    };
    Ok(Some(job_submission))
}
