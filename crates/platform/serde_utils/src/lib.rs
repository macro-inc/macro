#![deny(missing_docs)]
//! This crate aims to provide composable and resusable serde utilities

use serde::{Deserialize, Serialize};
use std::marker::PhantomData;

#[cfg(test)]
mod tests;

#[cfg(feature = "urlencode")]
pub mod urlencode;

/// A string of an alternative serde encoding.
/// For example if there is some json inside of a urlencoding
/// This allows declarative and typesafe extracion
/// See tests for usage
#[derive(Debug, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Container<T, Enc> {
    data: String,
    #[serde(skip)]
    expected: PhantomData<T>,
    #[serde(skip)]
    encoding: PhantomData<Enc>,
}

/// a trait which wraps over some serde encoding.
/// e.g. serde_json
pub trait Encoding<T> {
    /// the error type returned from this encoding
    type Err;
    /// Attempt to convert a string into the target type T
    fn from_str(s: &str) -> Result<T, Self::Err>;
    /// Attempt to convert the target type T into a string
    fn to_string(v: &T) -> Result<String, Self::Err>;
}

/// unit struct which indicates a string is json encoded
#[derive(Debug)]
pub struct JsonEncoding;

impl<T> Encoding<T> for JsonEncoding
where
    for<'de> T: Serialize + Deserialize<'de>,
{
    type Err = serde_json::Error;
    fn from_str(s: &str) -> Result<T, Self::Err> {
        serde_json::from_str(s)
    }

    fn to_string(v: &T) -> Result<String, Self::Err> {
        serde_json::to_string(v)
    }
}

impl<T, Enc> Container<T, Enc>
where
    Enc: Encoding<T>,
{
    /// Try to unwrap the inner type using the string and the encoding
    pub fn decode(self) -> Result<T, Enc::Err> {
        Enc::from_str(&self.data)
    }

    /// use encoding Enc to turn the type into a string.
    /// Return Self
    pub fn new(v: &T) -> Result<Self, Enc::Err> {
        let data = Enc::to_string(v)?;
        Ok(Container {
            data,
            expected: PhantomData,
            encoding: PhantomData,
        })
    }
}

/// A type which indicates a Json Encoded T
pub type JsonEncoded<T> = Container<T, JsonEncoding>;
