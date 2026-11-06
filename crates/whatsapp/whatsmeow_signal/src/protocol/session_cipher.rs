//
// Copyright 2020-2022 Signal Messenger, LLC.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Vendored from libsignal v0.74.1 rust/protocol/src/session_cipher.rs and
// modified by Macro: no post-quantum ratchet or Kyber payload, no expiry of
// unacknowledged sessions (go.mau.fi/libsignal has none), the stores are the
// port's `SignalProtocolStore`, and the failure logs leave out addresses and
// keys. See NOTICE.

use libsignal_core::curve::{KeyPair, PublicKey};
use rand::{CryptoRng, Rng};
use whatsmeow::signal::SignalAddress;

use super::consts::MAX_FORWARD_JUMPS;
use super::crypto;
use super::error::{Result, SignalProtocolError};
use super::messages::{
    CiphertextMessage, CiphertextMessageType, PreKeySignalMessage, SignalMessage,
};
use super::ratchet::{ChainKey, MessageKeys};
use super::session;
use super::session_state::{SessionRecord, SessionState};
use crate::store::ProtocolStore;

pub(crate) async fn message_encrypt(
    ptext: &[u8],
    remote_address: &SignalAddress,
    store: &ProtocolStore<'_>,
) -> Result<CiphertextMessage> {
    let mut session_record = store
        .load_session(remote_address)
        .await?
        .ok_or(SignalProtocolError::SessionNotFound)?;
    let session_state = session_record
        .session_state_mut()
        .ok_or(SignalProtocolError::SessionNotFound)?;

    let chain_key = session_state.get_sender_chain_key()?;
    let message_keys = chain_key.message_keys();

    let sender_ephemeral = session_state.sender_ratchet_key()?;
    let previous_counter = session_state.previous_counter();
    let session_version = session_state
        .session_version()
        .try_into()
        .map_err(|_| SignalProtocolError::InvalidSessionStructure("version does not fit in u8"))?;

    let local_identity_key = session_state.local_identity_key()?;
    let their_identity_key = session_state.remote_identity_key()?.ok_or_else(|| {
        SignalProtocolError::InvalidState("message_encrypt", "no remote identity key".to_owned())
    })?;

    let ctext = crypto::aes_256_cbc_encrypt(ptext, message_keys.cipher_key(), message_keys.iv())
        .map_err(|_| {
            SignalProtocolError::InvalidSessionStructure("invalid sender chain message keys")
        })?;

    let signal_message = SignalMessage::new(
        session_version,
        message_keys.mac_key(),
        sender_ephemeral,
        chain_key.index(),
        previous_counter,
        &ctext,
        &local_identity_key,
        &their_identity_key,
    )?;

    let message = match session_state.unacknowledged_pre_key_message_items()? {
        Some(items) => CiphertextMessage::PreKeySignalMessage(PreKeySignalMessage::new(
            session_version,
            session_state.local_registration_id(),
            items.pre_key_id,
            items.signed_pre_key_id,
            items.base_key,
            local_identity_key,
            signal_message,
        )),
        None => CiphertextMessage::SignalMessage(signal_message),
    };

    session_state.set_sender_chain_key(&chain_key.next_chain_key());

    // XXX why is this check after everything else?!!
    if !store
        .is_trusted_identity(remote_address, &their_identity_key)
        .await?
    {
        return Err(SignalProtocolError::UntrustedIdentity);
    }

    // XXX this could be combined with the above call to the identity store (in a new API)
    store
        .save_identity(remote_address, &their_identity_key)
        .await?;

    store.store_session(remote_address, &session_record).await?;
    Ok(message)
}

pub(crate) async fn message_decrypt_prekey<R: Rng + CryptoRng>(
    ciphertext: &PreKeySignalMessage,
    remote_address: &SignalAddress,
    store: &ProtocolStore<'_>,
    csprng: &mut R,
) -> Result<Vec<u8>> {
    let mut session_record = store
        .load_session(remote_address)
        .await?
        .unwrap_or_else(SessionRecord::new_fresh);

    let pre_key_used =
        session::process_prekey(ciphertext, remote_address, &mut session_record, store).await?;

    let ptext = decrypt_message_with_record(
        &mut session_record,
        ciphertext.message(),
        CiphertextMessageType::PreKey,
        csprng,
    )?;

    store
        .save_identity(remote_address, ciphertext.identity_key())
        .await?;

    store.store_session(remote_address, &session_record).await?;

    if let Some(pre_key_id) = pre_key_used {
        store.remove_pre_key(pre_key_id).await?;
    }

    Ok(ptext)
}

pub(crate) async fn message_decrypt_signal<R: Rng + CryptoRng>(
    ciphertext: &SignalMessage,
    remote_address: &SignalAddress,
    store: &ProtocolStore<'_>,
    csprng: &mut R,
) -> Result<Vec<u8>> {
    let mut session_record = store
        .load_session(remote_address)
        .await?
        .ok_or(SignalProtocolError::SessionNotFound)?;

    let ptext = decrypt_message_with_record(
        &mut session_record,
        ciphertext,
        CiphertextMessageType::Whisper,
        csprng,
    )?;

    // Why are we performing this check after decryption instead of before?
    let their_identity_key = session_record
        .session_state()
        .and_then(|state| state.remote_identity_key().ok().flatten())
        .ok_or(SignalProtocolError::InvalidSessionStructure(
            "successfully decrypted; must have a remote identity key",
        ))?;

    if !store
        .is_trusted_identity(remote_address, &their_identity_key)
        .await?
    {
        return Err(SignalProtocolError::UntrustedIdentity);
    }

    store
        .save_identity(remote_address, &their_identity_key)
        .await?;

    store.store_session(remote_address, &session_record).await?;

    Ok(ptext)
}

fn decrypt_message_with_record<R: Rng + CryptoRng>(
    record: &mut SessionRecord,
    ciphertext: &SignalMessage,
    original_message_type: CiphertextMessageType,
    csprng: &mut R,
) -> Result<Vec<u8>> {
    if let Some(current_state) = record.session_state() {
        let mut current_state = current_state.clone();
        let result = decrypt_message_with_state(
            &mut current_state,
            ciphertext,
            original_message_type,
            csprng,
        );

        match result {
            Ok(ptext) => {
                record.set_session_state(current_state); // update the state
                return Ok(ptext);
            }
            Err(SignalProtocolError::DuplicatedMessage(_, _)) => {
                return result;
            }
            Err(error) => {
                tracing::warn!(?error, message_type = ?original_message_type, "failed to decrypt with the current session");
                if original_message_type == CiphertextMessageType::PreKey {
                    // A PreKey message creates a session and then decrypts a Whisper message
                    // using that session. No need to check older sessions.
                    return Err(SignalProtocolError::InvalidMessage(
                        original_message_type,
                        "decryption failed",
                    ));
                }
            }
        }
    }

    // Try some old sessions:
    let mut updated_session = None;

    for (idx, previous) in record.previous_session_states().enumerate() {
        let mut previous = previous?;

        let result =
            decrypt_message_with_state(&mut previous, ciphertext, original_message_type, csprng);

        match result {
            Ok(ptext) => {
                updated_session = Some((ptext, idx, previous));
                break;
            }
            Err(SignalProtocolError::DuplicatedMessage(_, _)) => {
                return result;
            }
            Err(error) => {
                tracing::warn!(?error, message_type = ?original_message_type, previous_session = idx, "failed to decrypt with a previous session");
            }
        }
    }

    if let Some((ptext, idx, updated_session)) = updated_session {
        record.promote_old_session(idx, updated_session);
        Ok(ptext)
    } else {
        Err(SignalProtocolError::InvalidMessage(
            original_message_type,
            "decryption failed",
        ))
    }
}

fn decrypt_message_with_state<R: Rng + CryptoRng>(
    state: &mut SessionState,
    ciphertext: &SignalMessage,
    original_message_type: CiphertextMessageType,
    csprng: &mut R,
) -> Result<Vec<u8>> {
    // Check for a completely empty or invalid session state before we do anything else.
    let _ = state.root_key().map_err(|_| {
        SignalProtocolError::InvalidMessage(
            original_message_type,
            "No session available to decrypt",
        )
    })?;

    let ciphertext_version = ciphertext.message_version() as u32;
    if ciphertext_version != state.session_version() {
        return Err(SignalProtocolError::UnrecognizedMessageVersion(
            ciphertext_version,
        ));
    }

    let their_ephemeral = ciphertext.sender_ratchet_key();
    let counter = ciphertext.counter();
    let chain_key = get_or_create_chain_key(state, their_ephemeral, csprng)?;
    let message_keys = get_or_create_message_key(
        state,
        their_ephemeral,
        original_message_type,
        &chain_key,
        counter,
    )?;

    let their_identity_key =
        state
            .remote_identity_key()?
            .ok_or(SignalProtocolError::InvalidSessionStructure(
                "cannot decrypt without remote identity key",
            ))?;

    let mac_valid = ciphertext.verify_mac(
        &their_identity_key,
        &state.local_identity_key()?,
        message_keys.mac_key(),
    )?;

    if !mac_valid {
        return Err(SignalProtocolError::InvalidMessage(
            original_message_type,
            "MAC verification failed",
        ));
    }

    let ptext = match crypto::aes_256_cbc_decrypt(
        ciphertext.body(),
        message_keys.cipher_key(),
        message_keys.iv(),
    ) {
        Ok(ptext) => ptext,
        Err(crypto::DecryptionError::BadKeyOrIv) => {
            return Err(SignalProtocolError::InvalidSessionStructure(
                "invalid receiver chain message keys",
            ));
        }
        Err(crypto::DecryptionError::BadCiphertext(reason)) => {
            tracing::warn!(reason, "failed to decrypt 1:1 message");
            return Err(SignalProtocolError::InvalidMessage(
                original_message_type,
                "failed to decrypt",
            ));
        }
    };

    state.clear_unacknowledged_pre_key_message();

    Ok(ptext)
}

fn get_or_create_chain_key<R: Rng + CryptoRng>(
    state: &mut SessionState,
    their_ephemeral: &PublicKey,
    csprng: &mut R,
) -> Result<ChainKey> {
    if let Some(chain) = state.get_receiver_chain_key(their_ephemeral)? {
        return Ok(chain);
    }

    let root_key = state.root_key()?;
    let our_ephemeral = state.sender_ratchet_private_key()?;
    let receiver_chain = root_key.create_chain(their_ephemeral, &our_ephemeral)?;
    let our_new_ephemeral = KeyPair::generate(csprng);
    let sender_chain = receiver_chain
        .0
        .create_chain(their_ephemeral, &our_new_ephemeral.private_key)?;

    state.set_root_key(&sender_chain.0);
    state.add_receiver_chain(their_ephemeral, &receiver_chain.1);

    let current_index = state.get_sender_chain_key()?.index();
    let previous_index = current_index.saturating_sub(1);
    state.set_previous_counter(previous_index);
    state.set_sender_chain(&our_new_ephemeral, &sender_chain.1);

    Ok(receiver_chain.1)
}

fn get_or_create_message_key(
    state: &mut SessionState,
    their_ephemeral: &PublicKey,
    original_message_type: CiphertextMessageType,
    chain_key: &ChainKey,
    counter: u32,
) -> Result<MessageKeys> {
    let chain_index = chain_key.index();

    if chain_index > counter {
        return match state.get_message_keys(their_ephemeral, counter)? {
            Some(keys) => Ok(keys),
            None => Err(SignalProtocolError::DuplicatedMessage(chain_index, counter)),
        };
    }

    let jump = (counter - chain_index) as usize;

    if jump > MAX_FORWARD_JUMPS && !state.session_with_self()? {
        return Err(SignalProtocolError::InvalidMessage(
            original_message_type,
            "message from too far into the future",
        ));
    }

    let mut chain_key = chain_key.clone();

    while chain_key.index() < counter {
        state.set_message_keys(their_ephemeral, chain_key.message_keys())?;
        chain_key = chain_key.next_chain_key();
    }

    state.set_receiver_chain_key(their_ephemeral, &chain_key.next_chain_key())?;
    Ok(chain_key.message_keys())
}
