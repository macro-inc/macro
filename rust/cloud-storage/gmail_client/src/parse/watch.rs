use models_email::gmail::history::WatchResponse;

/// Maps the API response to our service model
pub fn map_watch_response_to_service(
    response: WatchResponse,
) -> models_email::gmail::history::WatchResponse {
    models_email::gmail::history::WatchResponse {
        history_id: response.history_id,
        expiration: response.expiration,
    }
}
