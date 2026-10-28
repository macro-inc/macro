//
// Copyright 2020-2022 Signal Messenger, LLC.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Vendored from libsignal v0.74.1 rust/protocol/src/session.rs and modified
// by Macro: X3DH only (no Kyber pre-keys, no post-quantum ratchet), bundles
// come from the whatsmeow port's `PreKeyBundle`, and the stores are the port's
// `SignalProtocolStore`. See NOTICE.

use libsignal_core::curve::{KeyPair, PublicKey};
use rand::{CryptoRng, Rng};
use whatsmeow::signal::{PreKeyBundle, SignalAddress};

use super::error::{Result, SignalProtocolError};
use super::messages::PreKeySignalMessage;
use super::ratchet::{self, AliceSignalProtocolParameters, BobSignalProtocolParameters};
use super::session_state::SessionRecord;
use crate::store::ProtocolStore;

/// Sets up the session a pre-key message starts, if it isn't set up yet.
///
/// Returns the one-time pre-key the message used, which the caller removes
/// once the message decrypted. The caller also saves the sender's identity
/// then.
pub(crate) async fn process_prekey(
    message: &PreKeySignalMessage,
    remote_address: &SignalAddress,
    session_record: &mut SessionRecord,
    store: &ProtocolStore<'_>,
) -> Result<Option<u32>> {
    if !store
        .is_trusted_identity(remote_address, message.identity_key())
        .await?
    {
        return Err(SignalProtocolError::UntrustedIdentity);
    }

    if session_record.promote_matching_session(
        message.message_version() as u32,
        &message.base_key().serialize(),
    )? {
        // We've already set up a session for this message, we can exit early.
        return Ok(None);
    }

    let our_signed_pre_key_pair = store.signed_pre_key(message.signed_pre_key_id())?;

    let our_one_time_pre_key_pair = match message.pre_key_id() {
        Some(pre_key_id) => Some(store.pre_key(pre_key_id).await?),
        None => {
            tracing::warn!("processing PreKey message which had no one-time prekey");
            None
        }
    };

    let parameters = BobSignalProtocolParameters {
        our_identity_key_pair: store.identity_key_pair()?,
        our_signed_pre_key_pair,
        our_one_time_pre_key_pair,
        our_ratchet_key_pair: our_signed_pre_key_pair,
        their_identity_key: *message.identity_key(),
        their_base_key: *message.base_key(),
    };

    let mut new_session = ratchet::initialize_bob_session(&parameters)?;

    new_session.set_local_registration_id(store.local_registration_id());
    new_session.set_remote_registration_id(message.registration_id());

    session_record.promote_state(new_session);

    Ok(message.pre_key_id())
}

pub(crate) async fn process_prekey_bundle<R: Rng + CryptoRng>(
    remote_address: &SignalAddress,
    store: &ProtocolStore<'_>,
    bundle: &PreKeyBundle,
    csprng: &mut R,
) -> Result<()> {
    let their_identity_key = PublicKey::from_djb_public_key_bytes(&bundle.identity_key)?;

    if !store
        .is_trusted_identity(remote_address, &their_identity_key)
        .await?
    {
        return Err(SignalProtocolError::UntrustedIdentity);
    }

    let their_signed_prekey = PublicKey::from_djb_public_key_bytes(&bundle.signed_pre_key_public)?;
    if !their_identity_key.verify_signature(
        &their_signed_prekey.serialize(),
        &bundle.signed_pre_key_signature,
    ) {
        return Err(SignalProtocolError::SignatureValidationFailed);
    }

    let mut session_record = store
        .load_session(remote_address)
        .await?
        .unwrap_or_else(SessionRecord::new_fresh);

    let our_base_key_pair = KeyPair::generate(csprng);

    let their_one_time_pre_key = bundle
        .pre_key
        .map(|(id, public)| {
            Ok::<_, SignalProtocolError>((id, PublicKey::from_djb_public_key_bytes(&public)?))
        })
        .transpose()?;

    let parameters = AliceSignalProtocolParameters {
        our_identity_key_pair: store.identity_key_pair()?,
        our_base_key_pair,
        their_identity_key,
        their_signed_pre_key: their_signed_prekey,
        their_one_time_pre_key: their_one_time_pre_key.map(|(_, key)| key),
        their_ratchet_key: their_signed_prekey,
    };

    let mut session = ratchet::initialize_alice_session(&parameters, csprng)?;

    session.set_unacknowledged_pre_key_message(
        their_one_time_pre_key.map(|(id, _)| id),
        bundle.signed_pre_key_id,
        &our_base_key_pair.public_key,
    );

    session.set_local_registration_id(store.local_registration_id());
    session.set_remote_registration_id(bundle.registration_id);

    store
        .save_identity(remote_address, &their_identity_key)
        .await?;

    session_record.promote_state(session);

    store.store_session(remote_address, &session_record).await
}
