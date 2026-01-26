//! Worker for processing queued notifications.
//!
//! This module handles delivery of notifications that have been validated
//! and persisted. The main work (rate limiting, filtering) is done pre-queue,
//! so this worker focuses on delivery.
