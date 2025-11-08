/*!
Metering  Service

A service for tracking and reporting AI service usage metrics.
*/

#![warn(
    unreachable_pub,
    redundant_lifetimes,
    unsafe_code,
    non_local_definitions,
    clippy::needless_pass_by_value,
    clippy::needless_pass_by_ref_mut
)]

pub mod api;
pub mod config;
pub mod constants;
