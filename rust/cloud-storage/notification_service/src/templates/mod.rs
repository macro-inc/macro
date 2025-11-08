use url::Url;

pub mod channel_invite;
pub mod channel_message;
pub mod item_share;

/// Adds a query param to the URL to skip offboarding.
pub fn add_skip_offboarding_query_param(mut url: Url) -> Url {
    url.query_pairs_mut()
        .append_pair("skip_offboarding", "true");

    url
}

#[cfg(test)]
mod test;
