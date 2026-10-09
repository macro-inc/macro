//! Big-endian reading and writing: the integers, floats, and strings
//! Photoshop files are made of.

use crate::error::{PsdError, Result};

/// A cursor over bytes.
#[derive(Clone, Debug)]
pub struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

fn short(what: &str) -> PsdError {
    PsdError::corrupt(format!("unexpected end of data reading {what}"))
}

impl<'a> Reader<'a> {
    /// A cursor at the start of `data`.
    pub fn new(data: &'a [u8]) -> Reader<'a> {
        Reader { data, pos: 0 }
    }

    /// The whole input.
    pub fn data(&self) -> &'a [u8] {
        self.data
    }

    /// Offset from the start.
    pub fn pos(&self) -> usize {
        self.pos
    }

    /// Moves to an offset (clamped to the end).
    pub fn seek(&mut self, pos: usize) {
        self.pos = pos.min(self.data.len());
    }

    /// Bytes left.
    pub fn remaining(&self) -> usize {
        self.data.len() - self.pos
    }

    /// Whether every byte was read.
    pub fn is_empty(&self) -> bool {
        self.remaining() == 0
    }

    /// The next `n` bytes, without moving.
    pub fn peek(&self, n: usize) -> Option<&'a [u8]> {
        self.data.get(self.pos..self.pos + n)
    }

    /// The next `n` bytes.
    pub fn bytes(&mut self, n: usize) -> Result<&'a [u8]> {
        let end = self.pos.checked_add(n).ok_or_else(|| short("bytes"))?;
        let out = self.data.get(self.pos..end).ok_or_else(|| short("bytes"))?;
        self.pos = end;
        Ok(out)
    }

    /// Skips `n` bytes.
    pub fn skip(&mut self, n: usize) -> Result<()> {
        self.bytes(n).map(|_| ())
    }

    /// A sub-reader over the next `n` bytes (this reader moves past them).
    pub fn take(&mut self, n: usize) -> Result<Reader<'a>> {
        Ok(Reader::new(self.bytes(n)?))
    }

    fn array<const N: usize>(&mut self) -> Result<[u8; N]> {
        let b = self.bytes(N)?;
        let mut out = [0u8; N];
        out.copy_from_slice(b);
        Ok(out)
    }

    /// A byte.
    pub fn u8(&mut self) -> Result<u8> {
        Ok(self.array::<1>()?[0])
    }

    /// A signed byte.
    pub fn i8(&mut self) -> Result<i8> {
        Ok(self.u8()? as i8)
    }

    /// A 16-bit unsigned integer.
    pub fn u16(&mut self) -> Result<u16> {
        Ok(u16::from_be_bytes(self.array()?))
    }

    /// A 16-bit signed integer.
    pub fn i16(&mut self) -> Result<i16> {
        Ok(i16::from_be_bytes(self.array()?))
    }

    /// A 32-bit unsigned integer.
    pub fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_be_bytes(self.array()?))
    }

    /// A 32-bit signed integer.
    pub fn i32(&mut self) -> Result<i32> {
        Ok(i32::from_be_bytes(self.array()?))
    }

    /// A 64-bit unsigned integer.
    pub fn u64(&mut self) -> Result<u64> {
        Ok(u64::from_be_bytes(self.array()?))
    }

    /// A 64-bit signed integer.
    pub fn i64(&mut self) -> Result<i64> {
        Ok(i64::from_be_bytes(self.array()?))
    }

    /// A 32-bit float.
    pub fn f32(&mut self) -> Result<f32> {
        Ok(f32::from_be_bytes(self.array()?))
    }

    /// A 64-bit float.
    pub fn f64(&mut self) -> Result<f64> {
        Ok(f64::from_be_bytes(self.array()?))
    }

    /// A 16.16 fixed-point number.
    pub fn fixed(&mut self) -> Result<f64> {
        Ok(self.i32()? as f64 / 65536.0)
    }

    /// A length: 32 bits, or 64 in large documents.
    pub fn length(&mut self, large: bool) -> Result<usize> {
        let n = if large {
            self.u64()?
        } else {
            u64::from(self.u32()?)
        };
        usize::try_from(n).map_err(|_| PsdError::corrupt("length out of range"))
    }

    /// A four-byte signature or key.
    pub fn sig(&mut self) -> Result<[u8; 4]> {
        self.array()
    }

    /// A Pascal string (a length byte then that many bytes), padded so the
    /// whole occupies a multiple of `pad` bytes. Returns the bytes without
    /// the length.
    pub fn pascal(&mut self, pad: usize) -> Result<&'a [u8]> {
        let n = self.u8()? as usize;
        let s = self.bytes(n)?;
        let used = n + 1;
        if pad > 1 && !used.is_multiple_of(pad) {
            self.skip((pad - used % pad).min(self.remaining()))?;
        }
        Ok(s)
    }

    /// A Unicode string: a 32-bit count of UTF-16 code units, then the
    /// units (a trailing NUL is dropped).
    pub fn unicode(&mut self) -> Result<String> {
        let n = self.u32()? as usize;
        if n > self.remaining() / 2 {
            return Err(short("a unicode string"));
        }
        let mut units = Vec::with_capacity(n);
        for _ in 0..n {
            units.push(self.u16()?);
        }
        if units.last() == Some(&0) {
            units.pop();
        }
        Ok(String::from_utf16_lossy(&units))
    }
}

/// A growing buffer of big-endian values.
#[derive(Clone, Debug, Default)]
pub struct Writer {
    /// The bytes written so far.
    pub buf: Vec<u8>,
}

impl Writer {
    /// An empty writer.
    pub fn new() -> Writer {
        Writer::default()
    }

    /// The bytes written.
    pub fn into_bytes(self) -> Vec<u8> {
        self.buf
    }

    /// Bytes written so far.
    pub fn len(&self) -> usize {
        self.buf.len()
    }

    /// Whether nothing was written.
    pub fn is_empty(&self) -> bool {
        self.buf.is_empty()
    }

    /// Raw bytes.
    pub fn bytes(&mut self, b: &[u8]) {
        self.buf.extend_from_slice(b);
    }

    /// A byte.
    pub fn u8(&mut self, v: u8) {
        self.buf.push(v);
    }

    /// `n` zero bytes.
    pub fn zeros(&mut self, n: usize) {
        self.buf.resize(self.buf.len() + n, 0);
    }

    /// A 16-bit unsigned integer.
    pub fn u16(&mut self, v: u16) {
        self.bytes(&v.to_be_bytes());
    }

    /// A 16-bit signed integer.
    pub fn i16(&mut self, v: i16) {
        self.bytes(&v.to_be_bytes());
    }

    /// A 32-bit unsigned integer.
    pub fn u32(&mut self, v: u32) {
        self.bytes(&v.to_be_bytes());
    }

    /// A 32-bit signed integer.
    pub fn i32(&mut self, v: i32) {
        self.bytes(&v.to_be_bytes());
    }

    /// A 64-bit unsigned integer.
    pub fn u64(&mut self, v: u64) {
        self.bytes(&v.to_be_bytes());
    }

    /// A 64-bit signed integer.
    pub fn i64(&mut self, v: i64) {
        self.bytes(&v.to_be_bytes());
    }

    /// A 32-bit float.
    pub fn f32(&mut self, v: f32) {
        self.bytes(&v.to_be_bytes());
    }

    /// A 64-bit float.
    pub fn f64(&mut self, v: f64) {
        self.bytes(&v.to_be_bytes());
    }

    /// A 16.16 fixed-point number.
    pub fn fixed(&mut self, v: f64) {
        self.i32((v * 65536.0).round() as i32);
    }

    /// A four-byte signature or key.
    pub fn sig(&mut self, s: &[u8; 4]) {
        self.bytes(s);
    }

    /// A length: 32 bits, or 64 in large documents.
    pub fn length(&mut self, n: usize, large: bool) {
        if large {
            self.u64(n as u64);
        } else {
            self.u32(n as u32);
        }
    }

    /// A Pascal string of at most 255 bytes, padded so the whole occupies
    /// a multiple of `pad` bytes.
    pub fn pascal(&mut self, s: &[u8], pad: usize) {
        let s = &s[..s.len().min(255)];
        self.u8(s.len() as u8);
        self.bytes(s);
        let used = s.len() + 1;
        if pad > 1 && !used.is_multiple_of(pad) {
            self.zeros(pad - used % pad);
        }
    }

    /// A Unicode string (count of UTF-16 units, then the units).
    pub fn unicode(&mut self, s: &str) {
        let units: Vec<u16> = s.encode_utf16().collect();
        self.u32(units.len() as u32);
        for u in units {
            self.u16(u);
        }
    }

    /// A Unicode string with a trailing NUL counted in its length, as
    /// Photoshop writes names in descriptors.
    pub fn unicode_nul(&mut self, s: &str) {
        let units: Vec<u16> = s.encode_utf16().collect();
        self.u32(units.len() as u32 + 1);
        for u in units {
            self.u16(u);
        }
        self.u16(0);
    }

    /// Reserves a length to fill in later (32 bits, or 64 for `large`);
    /// returns where it is.
    pub fn placeholder(&mut self, large: bool) -> usize {
        let at = self.buf.len();
        self.zeros(if large { 8 } else { 4 });
        at
    }

    /// Fills a reserved length with the bytes written since it, plus
    /// `extra`.
    pub fn fill_length(&mut self, at: usize, large: bool, extra: usize) {
        let width = if large { 8 } else { 4 };
        let n = self.buf.len() - at - width + extra;
        if large {
            self.buf[at..at + 8].copy_from_slice(&(n as u64).to_be_bytes());
        } else {
            self.buf[at..at + 4].copy_from_slice(&(n as u32).to_be_bytes());
        }
    }

    /// Pads with zeros to a multiple of `n` bytes from `from`.
    pub fn pad_from(&mut self, from: usize, n: usize) {
        let used = self.buf.len() - from;
        if n > 1 && !used.is_multiple_of(n) {
            self.zeros(n - used % n);
        }
    }
}

/// Text in MacRoman (Pascal names) as a string: ASCII as is, other bytes
/// through the MacRoman table.
pub fn mac_roman(bytes: &[u8]) -> String {
    const HIGH: [char; 128] = [
        'Ä', 'Å', 'Ç', 'É', 'Ñ', 'Ö', 'Ü', 'á', 'à', 'â', 'ä', 'ã', 'å', 'ç', 'é', 'è', 'ê', 'ë',
        'í', 'ì', 'î', 'ï', 'ñ', 'ó', 'ò', 'ô', 'ö', 'õ', 'ú', 'ù', 'û', 'ü', '†', '°', '¢', '£',
        '§', '•', '¶', 'ß', '®', '©', '™', '´', '¨', '≠', 'Æ', 'Ø', '∞', '±', '≤', '≥', '¥', 'µ',
        '∂', '∑', '∏', 'π', '∫', 'ª', 'º', 'Ω', 'æ', 'ø', '¿', '¡', '¬', '√', 'ƒ', '≈', '∆', '«',
        '»', '…', '\u{a0}', 'À', 'Ã', 'Õ', 'Œ', 'œ', '–', '—', '“', '”', '‘', '’', '÷', '◊', 'ÿ',
        'Ÿ', '⁄', '€', '‹', '›', 'ﬁ', 'ﬂ', '‡', '·', '‚', '„', '‰', 'Â', 'Ê', 'Á', 'Ë', 'È', 'Í',
        'Î', 'Ï', 'Ì', 'Ó', 'Ô', '\u{f8ff}', 'Ò', 'Ú', 'Û', 'Ù', 'ı', 'ˆ', '˜', '¯', '˘', '˙', '˚',
        '¸', '˝', '˛', 'ˇ',
    ];
    bytes
        .iter()
        .map(|&b| {
            if b < 0x80 {
                b as char
            } else {
                HIGH[(b - 0x80) as usize]
            }
        })
        .collect()
}

/// A string as MacRoman bytes (characters MacRoman lacks become `?`), for
/// Pascal names.
pub fn to_mac_roman(s: &str) -> Vec<u8> {
    s.chars()
        .map(|c| {
            if (c as u32) < 0x80 {
                return c as u8;
            }
            (0x80u8..=0xff)
                .find(|&b| mac_roman(&[b]).starts_with(c))
                .unwrap_or(b'?')
        })
        .collect()
}

#[cfg(test)]
mod test;
