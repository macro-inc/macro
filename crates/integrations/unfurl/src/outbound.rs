//! Outbound adapters that the domain drives.

mod http_safety;
mod reqwest_fetcher;
mod resolver;

pub use reqwest_fetcher::ReqwestUnfurlFetcher;
