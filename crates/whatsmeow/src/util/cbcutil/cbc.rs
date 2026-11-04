// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow util/cbcutil/cbc.go (MPL-2.0, Copyright (c) Tulir Asokan)

use std::io::{self, Read, Seek, SeekFrom, Write};

use aes::Aes256;
use aes::cipher::{BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

/// The AES block size.
pub const BLOCK_SIZE: usize = 16;
/// How much `decrypt_file` and `encrypt_stream` process at once.
const BUFFER_SIZE: usize = 32 * 1024;
/// How many bytes of the HMAC WhatsApp appends to encrypted media.
const MAC_SIZE: usize = 10;
const BLOCK_SIZE_U64: u64 = 16;
const BUFFER_SIZE_U64: u64 = 32 * 1024;

type Encryptor = cbc::Encryptor<Aes256>;
type Decryptor = cbc::Decryptor<Aes256>;
type HmacSha256 = Hmac<Sha256>;

/// An AES-CBC failure.
#[derive(Debug, thiserror::Error)]
pub enum CbcError {
    /// The key isn't 32 bytes or the IV isn't 16 bytes. Go also accepts
    /// AES-128 and AES-192 keys, but whatsmeow only ever passes 32-byte keys.
    #[error("invalid AES-256-CBC key or IV length")]
    InvalidKeyOrIv,
    /// The ciphertext is empty or not whole blocks.
    #[error("ciphertext isn't a multiple of block size: {0} / {BLOCK_SIZE}")]
    NotBlockAligned(u64),
    /// The padding byte is larger than the data.
    #[error("padding is greater then the length: {padding} / {length}")]
    InvalidPadding {
        /// The padding length the last byte claims.
        padding: u64,
        /// The data length.
        length: u64,
    },
    /// Reading or writing failed.
    #[error("{context}: {source}")]
    Io {
        /// What was being done.
        context: &'static str,
        /// The underlying failure.
        source: io::Error,
    },
}

fn io_error(context: &'static str) -> impl FnOnce(io::Error) -> CbcError {
    move |source| CbcError::Io { context, source }
}

/// Decrypts `ciphertext` with a key and IV and removes the padding.
pub fn decrypt(key: &[u8], iv: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, CbcError> {
    let mut decryptor =
        Decryptor::new_from_slices(key, iv).map_err(|_| CbcError::InvalidKeyOrIv)?;
    if ciphertext.is_empty() || !ciphertext.len().is_multiple_of(BLOCK_SIZE) {
        return Err(CbcError::NotBlockAligned(ciphertext.len() as u64));
    }
    let mut plaintext = ciphertext.to_vec();
    for block in plaintext.chunks_exact_mut(BLOCK_SIZE) {
        decryptor.decrypt_block_mut(block.into());
    }
    unpad(plaintext)
}

/// A file that can be decrypted in place: Go's `File` interface (`io.Reader`,
/// `io.WriterAt`, `Truncate`, `Stat`) expressed with seeking.
pub trait File: Read + Write + Seek {
    /// Shrinks the file to `size` bytes.
    fn truncate(&mut self, size: u64) -> io::Result<()>;
    /// The current size of the file.
    fn size(&self) -> io::Result<u64>;
}

impl File for std::fs::File {
    fn truncate(&mut self, size: u64) -> io::Result<()> {
        self.set_len(size)
    }

    fn size(&self) -> io::Result<u64> {
        Ok(self.metadata()?.len())
    }
}

/// Decrypts a whole file in place, from its start, and truncates the padding.
pub fn decrypt_file(key: &[u8], iv: &[u8], file: &mut impl File) -> Result<(), CbcError> {
    let mut decryptor =
        Decryptor::new_from_slices(key, iv).map_err(|_| CbcError::InvalidKeyOrIv)?;
    let file_size = file.size().map_err(io_error("failed to stat file"))?;
    if !file_size.is_multiple_of(BLOCK_SIZE_U64) {
        return Err(CbcError::NotBlockAligned(file_size));
    }

    let mut buffer = vec![0; BUFFER_SIZE];
    let mut write_pointer = 0;
    let mut last_byte = 0;
    while write_pointer < file_size {
        let chunk_length = usize::try_from((file_size - write_pointer).min(BUFFER_SIZE_U64))
            .unwrap_or(BUFFER_SIZE);
        let chunk = &mut buffer[..chunk_length];
        file.seek(SeekFrom::Start(write_pointer))
            .map_err(io_error("failed to read file"))?;
        file.read_exact(chunk)
            .map_err(io_error("failed to read file"))?;
        for block in chunk.chunks_exact_mut(BLOCK_SIZE) {
            decryptor.decrypt_block_mut(block.into());
        }
        file.seek(SeekFrom::Start(write_pointer))
            .map_err(io_error("failed to write file"))?;
        file.write_all(chunk)
            .map_err(io_error("failed to write file"))?;
        write_pointer += chunk_length as u64;
        last_byte = chunk[chunk_length - 1];
    }
    if u64::from(last_byte) > file_size {
        return Err(CbcError::InvalidPadding {
            padding: u64::from(last_byte),
            length: file_size,
        });
    }
    file.truncate(file_size - u64::from(last_byte))
        .map_err(io_error("failed to truncate file to remove padding"))
}

/// Pads and encrypts `plaintext`. Without an IV, a random one is generated and
/// prepended to the ciphertext.
pub fn encrypt(key: &[u8], iv: Option<&[u8]>, plaintext: &[u8]) -> Result<Vec<u8>, CbcError> {
    let generated_iv: [u8; BLOCK_SIZE];
    let (iv, mut ciphertext) = match iv {
        Some(iv) => (iv, Vec::with_capacity(plaintext.len() + BLOCK_SIZE)),
        None => {
            generated_iv = rand::random();
            (generated_iv.as_slice(), generated_iv.to_vec())
        }
    };
    let mut encryptor =
        Encryptor::new_from_slices(key, iv).map_err(|_| CbcError::InvalidKeyOrIv)?;
    let start = ciphertext.len();
    ciphertext.extend_from_slice(plaintext);
    pad(&mut ciphertext);
    for block in ciphertext[start..].chunks_exact_mut(BLOCK_SIZE) {
        encryptor.encrypt_block_mut(block.into());
    }
    Ok(ciphertext)
}

/// Appends PKCS#7 padding: 1 to 16 bytes, so there is always some.
fn pad(data: &mut Vec<u8>) {
    let padding = BLOCK_SIZE - data.len() % BLOCK_SIZE;
    // padding is between 1 and BLOCK_SIZE (16).
    let padding_byte = u8::try_from(padding).unwrap_or(u8::MAX);
    data.resize(data.len() + padding, padding_byte);
}

fn unpad(mut source: Vec<u8>) -> Result<Vec<u8>, CbcError> {
    let length = source.len();
    let padding = usize::from(source[length - 1]);
    if padding > length {
        return Err(CbcError::InvalidPadding {
            padding: padding as u64,
            length: length as u64,
        });
    }
    source.truncate(length - padding);
    Ok(source)
}

/// The result of [`encrypt_stream`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EncryptedStream {
    /// SHA-256 of the plaintext.
    pub plaintext_sha256: [u8; 32],
    /// SHA-256 of everything written: the ciphertext and the MAC.
    pub ciphertext_sha256: [u8; 32],
    /// The plaintext length.
    pub plaintext_length: u64,
    /// The written length: ciphertext with padding, plus the MAC.
    pub ciphertext_length: u64,
}

/// Encrypts a stream for upload: AES-256-CBC with padding, followed by the
/// first 10 bytes of HMAC-SHA256(iv || ciphertext) under `mac_key`.
pub fn encrypt_stream(
    key: &[u8],
    iv: &[u8],
    mac_key: &[u8],
    plaintext: &mut impl Read,
    ciphertext: &mut impl Write,
) -> Result<EncryptedStream, CbcError> {
    let mut encryptor =
        Encryptor::new_from_slices(key, iv).map_err(|_| CbcError::InvalidKeyOrIv)?;
    let mut plain_hasher = Sha256::new();
    let mut cipher_hasher = Sha256::new();
    let mut cipher_mac =
        <HmacSha256 as Mac>::new_from_slice(mac_key).map_err(|_| CbcError::InvalidKeyOrIv)?;
    cipher_mac.update(iv);

    let mut buffer = vec![0; BUFFER_SIZE];
    let mut size = 0;
    loop {
        let read = read_full(plaintext, &mut buffer).map_err(io_error("failed to read file"))?;
        plain_hasher.update(&buffer[..read]);
        size += read as u64;
        let has_more = read == BUFFER_SIZE;
        let mut chunk = buffer[..read].to_vec();
        if !has_more {
            pad(&mut chunk);
        }
        for block in chunk.chunks_exact_mut(BLOCK_SIZE) {
            encryptor.encrypt_block_mut(block.into());
        }
        cipher_mac.update(&chunk);
        cipher_hasher.update(&chunk);
        ciphertext
            .write_all(&chunk)
            .map_err(io_error("failed to write file"))?;
        if !has_more {
            break;
        }
    }
    let mac = cipher_mac.finalize().into_bytes();
    let mac = &mac[..MAC_SIZE];
    cipher_hasher.update(mac);
    ciphertext
        .write_all(mac)
        .map_err(io_error("failed to write checksum to file"))?;
    let padding = BLOCK_SIZE_U64 - size % BLOCK_SIZE_U64;
    Ok(EncryptedStream {
        plaintext_sha256: plain_hasher.finalize().into(),
        ciphertext_sha256: cipher_hasher.finalize().into(),
        plaintext_length: size,
        ciphertext_length: size + padding + MAC_SIZE as u64,
    })
}

/// Go's `io.ReadFull`, returning how much was read before the end of input.
fn read_full(reader: &mut impl Read, buffer: &mut [u8]) -> io::Result<usize> {
    let mut filled = 0;
    while filled < buffer.len() {
        match reader.read(&mut buffer[filled..]) {
            Ok(0) => break,
            Ok(read) => filled += read,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
    Ok(filled)
}

#[cfg(test)]
mod test;
