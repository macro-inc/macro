use crate::GmailClient;
use models_email::gmail::error::GmailError;
use models_email::gmail::filters::{Filter, FilterAction, FilterCriteria, ListFiltersResponse};

/// Creates a filter to block a user by sending their emails to TRASH.
/// This replicates the "Block Sender" functionality in the Superhuman UI.
#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn block_sender(
    client: &GmailClient,
    access_token: &str,
    email_to_block: &str,
) -> Result<Filter, GmailError> {
    let filter = Filter {
        id: None,
        criteria: FilterCriteria {
            from: Some(email_to_block.to_string()),
            to: None,
            subject: None,
            query: None,
            negated_query: None,
            has_attachment: None,
            exclude_chats: None,
        },

        action: FilterAction {
            add_label_ids: Some(vec!["TRASH".to_string()]),
            remove_label_ids: None,
            forward: None,
        },
    };

    create_filter(client, access_token, filter).await
}

/// Creates a new Gmail filter.
#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn create_filter(
    client: &GmailClient,
    access_token: &str,
    filter: Filter,
) -> Result<Filter, GmailError> {
    let url = format!("{}/users/me/settings/filters", client.base_url);

    let http_client = client.inner.clone();

    let response = http_client
        .post(&url)
        .bearer_auth(access_token)
        .json(&filter)
        .send()
        .await
        .map_err(|e| GmailError::HttpRequest(e.to_string()))?;

    let response = response.error_for_status().map_err(|e| match e.status() {
        Some(status) if status.as_u16() == 401 => GmailError::Unauthorized,
        Some(status) if status.as_u16() == 429 => GmailError::RateLimitExceeded,
        Some(status) if status.as_u16() == 409 => {
            GmailError::Conflict("Filter already exists".to_string())
        }
        _ => GmailError::ApiError(e.to_string()),
    })?;

    let created_filter = response
        .json::<Filter>()
        .await
        .map_err(|e| GmailError::BodyReadError(e.to_string()))?;

    Ok(created_filter)
}

/// Lists all filters for the user.
#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn list_filters(
    client: &GmailClient,
    access_token: &str,
) -> Result<Vec<Filter>, GmailError> {
    let url = format!("{}/users/me/settings/filters", client.base_url);

    let http_client = client.inner.clone();

    let response = http_client
        .get(&url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| GmailError::HttpRequest(e.to_string()))?;

    let response = response.error_for_status().map_err(|e| match e.status() {
        Some(status) if status.as_u16() == 401 => GmailError::Unauthorized,
        Some(status) if status.as_u16() == 429 => GmailError::RateLimitExceeded,
        _ => GmailError::ApiError(e.to_string()),
    })?;

    let filters_response = response
        .json::<ListFiltersResponse>()
        .await
        .map_err(|e| GmailError::BodyReadError(e.to_string()))?;

    Ok(filters_response.filter)
}

/// Gets a specific filter by ID.
#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn get_filter(
    client: &GmailClient,
    access_token: &str,
    filter_id: &str,
) -> Result<Filter, GmailError> {
    let url = format!(
        "{}/users/me/settings/filters/{}",
        client.base_url, filter_id
    );

    let http_client = client.inner.clone();

    let response = http_client
        .get(&url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| GmailError::HttpRequest(e.to_string()))?;

    let response = response.error_for_status().map_err(|e| match e.status() {
        Some(status) if status.as_u16() == 401 => GmailError::Unauthorized,
        Some(status) if status.as_u16() == 429 => GmailError::RateLimitExceeded,
        Some(status) if status.as_u16() == 404 => {
            GmailError::NotFound(format!("Filter {} not found", filter_id))
        }
        _ => GmailError::ApiError(e.to_string()),
    })?;

    let filter = response
        .json::<Filter>()
        .await
        .map_err(|e| GmailError::BodyReadError(e.to_string()))?;

    Ok(filter)
}

/// Deletes a filter by ID (can be used to "unblock" a user).
#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn delete_filter(
    client: &GmailClient,
    access_token: &str,
    filter_id: &str,
) -> Result<(), GmailError> {
    let url = format!(
        "{}/users/me/settings/filters/{}",
        client.base_url, filter_id
    );

    let http_client = client.inner.clone();

    let response = http_client
        .delete(&url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| GmailError::HttpRequest(e.to_string()))?;

    response.error_for_status().map_err(|e| match e.status() {
        Some(status) if status.as_u16() == 401 => GmailError::Unauthorized,
        Some(status) if status.as_u16() == 429 => GmailError::RateLimitExceeded,
        Some(status) if status.as_u16() == 404 => {
            GmailError::NotFound(format!("Filter {} not found", filter_id))
        }
        _ => GmailError::ApiError(e.to_string()),
    })?;

    Ok(())
}

/// Finds and returns any existing "block" filters for a specific email address.
/// This can be used to check if a user is already blocked.
#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn find_block_filter_for_sender(
    client: &GmailClient,
    access_token: &str,
    email_address: &str,
) -> Result<Option<Filter>, GmailError> {
    let filters = list_filters(client, access_token).await?;

    let block_filter = filters.into_iter().find(|f| {
        if let Some(from) = &f.criteria.from
            && from.eq_ignore_ascii_case(email_address)
        {
            // Check if add_label_ids contains TRASH
            return f
                .action
                .add_label_ids
                .as_ref()
                .map(|labels| labels.contains(&"TRASH".to_string()))
                .unwrap_or(false);
        }
        false
    });

    Ok(block_filter)
}

/// Unblocks a sender by finding and deleting their block filter.
/// Returns true if a filter was found and deleted, false if no filter existed.
#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn unblock_sender(
    client: &GmailClient,
    access_token: &str,
    email_address: &str,
) -> Result<bool, GmailError> {
    if let Some(filter) = find_block_filter_for_sender(client, access_token, email_address).await?
        && let Some(filter_id) = filter.id
    {
        delete_filter(client, access_token, &filter_id).await?;
        return Ok(true);
    }
    Ok(false)
}

/// Lists all blocked senders by finding filters that send emails to TRASH.
/// Returns a list of email addresses that are currently blocked.
#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn list_blocked_senders(
    client: &GmailClient,
    access_token: &str,
) -> Result<Vec<String>, GmailError> {
    let filters = list_filters(client, access_token).await?;

    let blocked_emails = filters
        .into_iter()
        .filter(|f| {
            // Check if add_label_ids contains TRASH
            f.action
                .add_label_ids
                .as_ref()
                .map(|labels| labels.contains(&"TRASH".to_string()))
                .unwrap_or(false)
        })
        .filter_map(|f| f.criteria.from)
        .collect();

    Ok(blocked_emails)
}
