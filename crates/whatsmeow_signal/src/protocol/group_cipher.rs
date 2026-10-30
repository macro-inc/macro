//
// Copyright 2020-2021 Signal Messenger, LLC.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Vendored from libsignal v0.74.1 rust/protocol/src/group_cipher.rs and
// modified by Macro: sender keys are named by the whatsmeow port's
// `SenderKeyName` (group and sender) instead of a distribution UUID, states
// are found by WhatsApp's key ID, and the stores are the port's
// `SignalProtocolStore`. Creating a distribution message replaces an empty
// record, as go.mau.fi/libsignal does. See NOTICE.

use libsignal_core::curve::KeyPair;
use rand::{CryptoRng, Rng};
use whatsmeow::signal::SenderKeyName;

use super::consts;
use super::crypto;
use super::error::{Result, SignalProtocolError};
use super::messages::{
    CiphertextMessageType, SENDERKEY_MESSAGE_CURRENT_VERSION, SenderKeyDistributionMessage,
    SenderKeyMessage,
};
use super::sender_keys::{SenderKeyRecord, SenderKeyState, SenderMessageKey};
use crate::store::ProtocolStore;

pub(crate) async fn group_encrypt<R: Rng + CryptoRng>(
    store: &ProtocolStore<'_>,
    name: &SenderKeyName,
    plaintext: &[u8],
    csprng: &mut R,
) -> Result<SenderKeyMessage> {
    let mut record = store
        .load_sender_key(name)
        .await?
        .ok_or(SignalProtocolError::NoSenderKeyState)?;

    let sender_key_state = record
        .sender_key_state_mut()
        .map_err(|_| SignalProtocolError::InvalidSenderKeySession)?;

    let sender_chain_key = sender_key_state
        .sender_chain_key()
        .ok_or(SignalProtocolError::InvalidSenderKeySession)?;

    let message_keys = sender_chain_key.sender_message_key();

    let ciphertext =
        crypto::aes_256_cbc_encrypt(plaintext, message_keys.cipher_key(), message_keys.iv())
            .map_err(|_| SignalProtocolError::InvalidSenderKeySession)?;

    let signing_key = sender_key_state
        .signing_key_private()
        .map_err(|_| SignalProtocolError::InvalidSenderKeySession)?;

    let skm = SenderKeyMessage::new(
        SENDERKEY_MESSAGE_CURRENT_VERSION,
        sender_key_state.key_id(),
        message_keys.iteration(),
        ciphertext.into_boxed_slice(),
        csprng,
        &signing_key,
    )?;

    sender_key_state.set_sender_chain_key(sender_chain_key.next()?);

    store.store_sender_key(name, &record).await?;

    Ok(skm)
}

fn get_sender_key(state: &mut SenderKeyState, iteration: u32) -> Result<SenderMessageKey> {
    let sender_chain_key = state
        .sender_chain_key()
        .ok_or(SignalProtocolError::InvalidSenderKeySession)?;
    let current_iteration = sender_chain_key.iteration();

    if current_iteration > iteration {
        return match state.remove_sender_message_key(iteration) {
            Some(smk) => Ok(smk),
            None => Err(SignalProtocolError::DuplicatedMessage(
                current_iteration,
                iteration,
            )),
        };
    }

    let jump = (iteration - current_iteration) as usize;
    if jump > consts::MAX_FORWARD_JUMPS {
        return Err(SignalProtocolError::InvalidMessage(
            CiphertextMessageType::SenderKey,
            "message from too far into the future",
        ));
    }

    let mut sender_chain_key = sender_chain_key;

    while sender_chain_key.iteration() < iteration {
        state.add_sender_message_key(&sender_chain_key.sender_message_key());
        sender_chain_key = sender_chain_key.next()?;
    }

    state.set_sender_chain_key(sender_chain_key.next()?);
    Ok(sender_chain_key.sender_message_key())
}

pub(crate) async fn group_decrypt(
    skm_bytes: &[u8],
    store: &ProtocolStore<'_>,
    name: &SenderKeyName,
) -> Result<Vec<u8>> {
    let skm = SenderKeyMessage::try_from(skm_bytes)?;

    let mut record = store
        .load_sender_key(name)
        .await?
        .ok_or(SignalProtocolError::NoSenderKeyState)?;

    let Some(sender_key_state) = record.sender_key_state_for_key_id(skm.key_id()) else {
        tracing::warn!(
            key_id = skm.key_id(),
            "no sender key state for the message's key ID"
        );
        return Err(SignalProtocolError::NoSenderKeyState);
    };

    if skm.message_version() != SENDERKEY_MESSAGE_CURRENT_VERSION {
        return Err(SignalProtocolError::UnrecognizedMessageVersion(
            skm.message_version() as u32,
        ));
    }

    let signing_key = sender_key_state
        .signing_key_public()
        .map_err(|_| SignalProtocolError::InvalidSenderKeySession)?;
    if !skm.verify_signature(&signing_key) {
        return Err(SignalProtocolError::SignatureValidationFailed);
    }

    let sender_key = get_sender_key(sender_key_state, skm.iteration())?;

    let plaintext = match crypto::aes_256_cbc_decrypt(
        skm.ciphertext(),
        sender_key.cipher_key(),
        sender_key.iv(),
    ) {
        Ok(plaintext) => plaintext,
        Err(crypto::DecryptionError::BadKeyOrIv) => {
            return Err(SignalProtocolError::InvalidSenderKeySession);
        }
        Err(crypto::DecryptionError::BadCiphertext(reason)) => {
            tracing::warn!(reason, "sender key decryption failed");
            return Err(SignalProtocolError::InvalidMessage(
                CiphertextMessageType::SenderKey,
                "decryption failed",
            ));
        }
    };

    store.store_sender_key(name, &record).await?;

    Ok(plaintext)
}

pub(crate) async fn process_sender_key_distribution_message(
    name: &SenderKeyName,
    skdm: &SenderKeyDistributionMessage,
    store: &ProtocolStore<'_>,
) -> Result<()> {
    let mut sender_key_record = store
        .load_sender_key(name)
        .await?
        .unwrap_or_else(SenderKeyRecord::new_empty);

    sender_key_record.add_sender_key_state(
        skdm.key_id(),
        skdm.iteration(),
        skdm.chain_key(),
        *skdm.signing_key(),
        None,
    );
    store.store_sender_key(name, &sender_key_record).await
}

pub(crate) async fn create_sender_key_distribution_message<R: Rng + CryptoRng>(
    name: &SenderKeyName,
    store: &ProtocolStore<'_>,
    csprng: &mut R,
) -> Result<SenderKeyDistributionMessage> {
    let sender_key_record = match store.load_sender_key(name).await? {
        Some(record) if record.sender_key_state().is_ok() => record,
        _ => {
            // libsignal-protocol-java uses 31-bit integers for sender key chain IDs
            let key_id = csprng.random::<u32>() >> 1;
            let iteration = 0;
            let sender_key: [u8; 32] = csprng.random();
            let signing_key = KeyPair::generate(csprng);
            let mut record = SenderKeyRecord::new_empty();
            record.add_sender_key_state(
                key_id,
                iteration,
                &sender_key,
                signing_key.public_key,
                Some(signing_key.private_key),
            );
            store.store_sender_key(name, &record).await?;
            record
        }
    };

    let state = sender_key_record
        .sender_key_state()
        .map_err(|_| SignalProtocolError::InvalidSenderKeySession)?;
    let sender_chain_key = state
        .sender_chain_key()
        .ok_or(SignalProtocolError::InvalidSenderKeySession)?;

    Ok(SenderKeyDistributionMessage::new(
        SENDERKEY_MESSAGE_CURRENT_VERSION,
        state.key_id(),
        sender_chain_key.iteration(),
        sender_chain_key.seed().to_vec(),
        state
            .signing_key_public()
            .map_err(|_| SignalProtocolError::InvalidSenderKeySession)?,
    ))
}
