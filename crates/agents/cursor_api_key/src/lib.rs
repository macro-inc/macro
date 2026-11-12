#![deny(missing_docs)]
//! A user's Cursor API key: how it is encrypted, and how it is stored.
//!
//! `@cursor` sessions run on the key their owner registered in settings rather
//! than one deployment-wide key, so the key is a per-user secret at rest. This
//! crate owns both halves of that — [`cipher`] turns a key into a KMS
//! ciphertext and back, [`store`] puts that ciphertext in a row and reads it
//! out again.
//!
//! The two live together because they are never useful apart: a caller holding
//! a ciphertext always needs the cipher to make sense of it, and a caller
//! holding a plaintext key always needs somewhere to put it. Splitting them
//! into sibling crates would only mean every consumer depending on both.
//!
//! # Threat model
//!
//! The row is not the exposure. A `cursor_configs` row is a KMS ciphertext
//! blob, useless without a KMS call that IAM gates and CloudTrail records, and
//! bound by its encryption context to exactly one user — so a row copied into
//! another user's id does not decrypt. What is worth worrying about is
//! *plaintext residency*: the key is decrypted on every session spawn and every
//! resume, and anything that holds it after that is a copy in a long-lived
//! process. Hence [`cipher::CursorApiKey`], which redacts its `Debug` and
//! zeroizes on drop, and hence the rule that a decrypted key is turned into an
//! HTTP header and dropped rather than kept for a session's lifetime.
//!
//! Deleting a row does not revoke anything at Cursor. Any surface that offers
//! to "disconnect" has to say so.

/// Encrypting and decrypting a key with AWS KMS.
pub mod cipher;

/// Reading and writing the encrypted key's row.
pub mod store;
