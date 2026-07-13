pub mod http_safety;
mod unfurl;
pub use unfurl::{
    BULK_CONCURRENCY, GetUnfurlResponse, GetUnfurlResponseList, MAX_HTML_SIZE, UnfurlFetchError,
    append_optimistic_favico, extract_meta_tags, extract_meta_tags_mock, extract_meta_tags_prod,
    favico_url, fetch_links_async, url_parsers,
};
