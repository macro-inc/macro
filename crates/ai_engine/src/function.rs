//! PDF functions: sampled (type 0), exponential (2), stitching (3), and
//! PostScript calculator (4), and arrays of single-output functions acting
//! as one. Inputs are clipped to the domain and outputs to the range.
//!
//! Sampled functions interpolate linearly between samples in every
//! dimension (cubic ones, `Order 3`, included).

mod postscript;
pub(crate) mod read;

use crate::error::{AiError, Result};
use crate::pdf::{Dict, Object, Resolve};
use read::{Bits, clamp, dict_int, dict_number, dict_numbers, get, lerp_map, pairs};

/// Functions nested in stitching functions and arrays.
const MAX_DEPTH: usize = 8;
/// Inputs and outputs a function may have (the DeviceN colorant limit).
pub const MAX_ARITY: usize = 32;
/// Sample values a sampled function may hold.
const MAX_SAMPLES: usize = 1 << 21;
/// Interpolated dimensions of a sampled function; past this, the nearest
/// sample is used (multilinear interpolation visits `2^n` corners).
const MAX_INTERPOLATED: usize = 10;

/// A function.
#[derive(Clone, Debug, PartialEq)]
pub struct Function {
    /// Input intervals, one per input.
    domain: Vec<[f32; 2]>,
    /// Output intervals, one per output, when outputs are clipped.
    range: Option<Vec<[f32; 2]>>,
    kind: Kind,
}

#[derive(Clone, Debug, PartialEq)]
enum Kind {
    Sampled(Sampled),
    Exponential {
        c0: Vec<f32>,
        c1: Vec<f32>,
        n: f32,
    },
    Stitching {
        functions: Vec<Function>,
        bounds: Vec<f32>,
        encode: Vec<[f32; 2]>,
    },
    PostScript {
        program: postscript::Program,
        outputs: usize,
    },
    /// Single-output functions, one per output.
    Array(Vec<Function>),
}

/// A sampled function's table.
#[derive(Clone, Debug, PartialEq)]
struct Sampled {
    /// Samples along each input.
    size: Vec<usize>,
    /// Input intervals mapped onto sample positions.
    encode: Vec<[f32; 2]>,
    /// Sample values with `Decode` applied, outputs adjacent, the first
    /// input varying fastest.
    samples: Vec<f32>,
    outputs: usize,
}

fn corrupt(what: &str) -> AiError {
    AiError::corrupt(format!("function: {what}"))
}

impl Function {
    /// Reads a function (a dictionary or stream), or an array of
    /// single-output functions acting as one.
    pub fn parse(pdf: &dyn Resolve, value: &Object) -> Result<Function> {
        parse(pdf, value, 0)
    }

    /// Evaluates at `input` (clipped to the domain); outputs are clipped to
    /// the range when there is one.
    pub fn eval(&self, input: &[f32]) -> Vec<f32> {
        let mut out = vec![0.0; self.outputs()];
        self.eval_into(input, &mut out);
        out
    }

    /// [`Function::eval`] without allocating: writes the outputs to the
    /// start of `out` (as many as fit). Missing inputs read as `0`.
    pub fn eval_into(&self, input: &[f32], out: &mut [f32]) {
        let mut x = [0.0f32; MAX_ARITY];
        let inputs = self.inputs();
        for (i, (xi, [d0, d1])) in x.iter_mut().zip(&self.domain).enumerate() {
            *xi = clamp(input.get(i).copied().unwrap_or(0.0), *d0, *d1);
        }
        let x = &x[..inputs];
        let n = self.outputs().min(out.len());
        let out = &mut out[..n];
        match &self.kind {
            Kind::Sampled(s) => eval_sampled(s, &self.domain, x, out),
            Kind::Exponential { c0, c1, n: exp } => {
                let t = x.first().copied().unwrap_or(0.0);
                // Fractional powers of negative numbers and negative powers
                // of zero are outside the domain; they read as zero.
                let p = if *exp == 1.0 {
                    t
                } else if (t < 0.0 && exp.fract() != 0.0) || (t == 0.0 && *exp < 0.0) {
                    0.0
                } else {
                    t.powf(*exp)
                };
                for (j, o) in out.iter_mut().enumerate() {
                    let a = c0.get(j).copied().unwrap_or(0.0);
                    let b = c1.get(j).copied().unwrap_or(1.0);
                    *o = a + p * (b - a);
                }
            }
            Kind::Stitching {
                functions,
                bounds,
                encode,
            } => {
                let t = x.first().copied().unwrap_or(0.0);
                let [d0, d1] = self.domain.first().copied().unwrap_or([0.0, 1.0]);
                let k = bounds.iter().take_while(|&&b| t >= b).count();
                let k = k.min(functions.len().saturating_sub(1));
                let lo = if k == 0 { d0 } else { bounds[k - 1] };
                let hi = bounds.get(k).copied().unwrap_or(d1);
                let [e0, e1] = encode.get(k).copied().unwrap_or([0.0, 1.0]);
                if let Some(f) = functions.get(k) {
                    f.eval_into(&[lerp_map(t, lo, hi, e0, e1)], out);
                }
            }
            Kind::PostScript { program, .. } => {
                if !program.run(x, out) {
                    out.fill(0.0);
                }
            }
            Kind::Array(functions) => {
                for (o, f) in out.iter_mut().zip(functions) {
                    let mut v = [0.0];
                    f.eval_into(x, &mut v);
                    *o = v[0];
                }
            }
        }
        for (j, o) in out.iter_mut().enumerate() {
            match self.range.as_ref().and_then(|r| r.get(j)) {
                Some([r0, r1]) => *o = clamp(*o, *r0, *r1),
                None if !o.is_finite() => *o = 0.0,
                None => {}
            }
        }
    }

    /// Inputs it takes.
    pub fn inputs(&self) -> usize {
        self.domain.len()
    }

    /// Outputs it gives.
    pub fn outputs(&self) -> usize {
        if let Some(range) = &self.range {
            return range.len();
        }
        match &self.kind {
            Kind::Sampled(s) => s.outputs,
            Kind::Exponential { c0, .. } => c0.len(),
            Kind::Stitching { functions, .. } => functions.first().map_or(0, Function::outputs),
            Kind::PostScript { outputs, .. } => *outputs,
            Kind::Array(functions) => functions.len(),
        }
    }

    /// The input domain, `[min, max]` per input.
    pub fn domain(&self) -> &[[f32; 2]] {
        &self.domain
    }

    /// A stitching function's subdomain boundaries (none for other types),
    /// where its output may jump.
    pub fn bounds(&self) -> &[f32] {
        match &self.kind {
            Kind::Stitching { bounds, .. } => bounds,
            _ => &[],
        }
    }
}

fn parse(pdf: &dyn Resolve, value: &Object, depth: usize) -> Result<Function> {
    if depth > MAX_DEPTH {
        return Err(corrupt("nested too deeply"));
    }
    let value = pdf.resolve(value);
    if let Object::Array(items) = &value {
        if items.is_empty() || items.len() > MAX_ARITY {
            return Err(corrupt("bad function array"));
        }
        let functions = items
            .iter()
            .map(|f| parse(pdf, f, depth + 1))
            .collect::<Result<Vec<_>>>()?;
        let domain = functions[0].domain.clone();
        return Ok(Function {
            domain,
            range: None,
            kind: Kind::Array(functions),
        });
    }
    let dict = value.as_dict().ok_or_else(|| corrupt("not a dictionary"))?;
    let domain = dict_numbers(pdf, dict, "Domain")
        .map(|d| pairs(&d))
        .filter(|d| !d.is_empty() && d.len() <= MAX_ARITY)
        .unwrap_or_else(|| vec![[0.0, 1.0]]);
    let range = dict_numbers(pdf, dict, "Range")
        .map(|r| pairs(&r))
        .filter(|r| !r.is_empty() && r.len() <= MAX_ARITY);
    let kind = match dict_int(pdf, dict, "FunctionType") {
        Some(0) => {
            let range = range
                .as_ref()
                .ok_or_else(|| corrupt("sampled without Range"))?;
            Kind::Sampled(parse_sampled(pdf, &value, dict, domain.len(), range)?)
        }
        Some(2) => {
            let mut c0 = dict_numbers(pdf, dict, "C0").unwrap_or_else(|| vec![0.0]);
            let mut c1 = dict_numbers(pdf, dict, "C1").unwrap_or_else(|| vec![1.0]);
            // When one is shorter, its missing values take the defaults.
            let n = c0.len().max(c1.len());
            if n == 0 || n > MAX_ARITY {
                return Err(corrupt("bad C0 or C1"));
            }
            c0.resize(n, 0.0);
            c1.resize(n, 1.0);
            let n = dict_number(pdf, dict, "N").ok_or_else(|| corrupt("no N"))?;
            Kind::Exponential { c0, c1, n }
        }
        Some(3) => parse_stitching(pdf, dict, &domain, depth)?,
        Some(4) => {
            let range = range
                .as_ref()
                .ok_or_else(|| corrupt("calculator without Range"))?;
            let stream = value.as_stream().ok_or_else(|| corrupt("not a stream"))?;
            let text = pdf.stream_data(stream)?;
            Kind::PostScript {
                program: postscript::Program::compile(&text)?,
                outputs: range.len(),
            }
        }
        _ => return Err(corrupt("unknown FunctionType")),
    };
    Ok(Function {
        domain,
        range,
        kind,
    })
}

fn parse_stitching(
    pdf: &dyn Resolve,
    dict: &Dict,
    domain: &[[f32; 2]],
    depth: usize,
) -> Result<Kind> {
    let functions = get(pdf, dict, "Functions");
    let functions = functions
        .as_array()
        .filter(|f| !f.is_empty() && f.len() <= 1024)
        .ok_or_else(|| corrupt("stitching without Functions"))?
        .iter()
        .map(|f| parse(pdf, f, depth + 1))
        .collect::<Result<Vec<_>>>()?;
    let k = functions.len();
    let mut bounds = dict_numbers(pdf, dict, "Bounds").unwrap_or_default();
    bounds.resize(k - 1, domain[0][1]);
    let encode = dict_numbers(pdf, dict, "Encode")
        .map(|e| pairs(&e))
        .filter(|e| e.len() >= k)
        .unwrap_or_else(|| vec![[0.0, 1.0]; k]);
    Ok(Kind::Stitching {
        functions,
        bounds,
        encode,
    })
}

fn parse_sampled(
    pdf: &dyn Resolve,
    value: &Object,
    dict: &Dict,
    inputs: usize,
    range: &[[f32; 2]],
) -> Result<Sampled> {
    let stream = value
        .as_stream()
        .ok_or_else(|| corrupt("sampled function is not a stream"))?;
    let size = dict_numbers(pdf, dict, "Size")
        .ok_or_else(|| corrupt("sampled without Size"))?
        .iter()
        .map(|&s| (s >= 1.0 && s.fract() == 0.0).then_some(s as usize))
        .collect::<Option<Vec<usize>>>()
        .filter(|s| s.len() == inputs)
        .ok_or_else(|| corrupt("bad Size"))?;
    let bits = dict_int(pdf, dict, "BitsPerSample").unwrap_or(0);
    if ![1, 2, 4, 8, 12, 16, 24, 32].contains(&bits) {
        return Err(corrupt("bad BitsPerSample"));
    }
    let outputs = range.len();
    let count = size
        .iter()
        .try_fold(outputs, |n, &s| n.checked_mul(s))
        .filter(|&n| n <= MAX_SAMPLES)
        .ok_or_else(|| corrupt("too many samples"))?;
    let encode = dict_numbers(pdf, dict, "Encode")
        .map(|e| pairs(&e))
        .filter(|e| e.len() == inputs)
        .unwrap_or_else(|| size.iter().map(|&s| [0.0, (s - 1) as f32]).collect());
    let decode = dict_numbers(pdf, dict, "Decode")
        .map(|d| pairs(&d))
        .filter(|d| d.len() == outputs)
        .unwrap_or_else(|| range.to_vec());
    let data = pdf.stream_data(stream)?;
    let mut bits_reader = Bits::new(&data);
    let max = read::max_value(bits as u32);
    let mut samples = Vec::with_capacity(count);
    for i in 0..count {
        // Short data reads as zeros, as other readers do.
        let raw = bits_reader.read(bits as u32).unwrap_or(0) as f32;
        let [d0, d1] = decode[i % outputs];
        samples.push(d0 + raw * (d1 - d0) / max);
    }
    Ok(Sampled {
        size,
        encode,
        samples,
        outputs,
    })
}

/// Multilinear interpolation between the samples around `x`.
fn eval_sampled(s: &Sampled, domain: &[[f32; 2]], x: &[f32], out: &mut [f32]) {
    let n = s.outputs;
    // (stride, fraction) of each input between two samples.
    let mut between = [(0usize, 0.0f32); MAX_ARITY];
    let mut count = 0;
    let mut base = 0;
    let mut stride = 1;
    for (i, &size) in s.size.iter().enumerate() {
        let [d0, d1] = domain[i];
        let [e0, e1] = s.encode[i];
        let last = (size - 1) as f32;
        let e = clamp(lerp_map(x[i], d0, d1, e0, e1), 0.0, last);
        let mut at = e.floor() as usize;
        if size > 1 && at >= size - 1 {
            at = size - 2;
        }
        let frac = if size > 1 { e - at as f32 } else { 0.0 };
        if frac > 0.0 {
            between[count] = (stride, frac);
            count += 1;
        }
        base += at * stride;
        stride *= size;
    }
    if count > MAX_INTERPOLATED {
        for &(stride, frac) in &between[..count] {
            if frac >= 0.5 {
                base += stride;
            }
        }
        count = 0;
    }
    out.fill(0.0);
    for corner in 0..(1usize << count) {
        let mut weight = 1.0;
        let mut at = base;
        for (k, &(stride, frac)) in between[..count].iter().enumerate() {
            if corner & (1 << k) != 0 {
                weight *= frac;
                at += stride;
            } else {
                weight *= 1.0 - frac;
            }
        }
        if weight == 0.0 {
            continue;
        }
        let values = &s.samples[at * n..at * n + n];
        for (o, v) in out.iter_mut().zip(values) {
            *o += weight * v;
        }
    }
}

#[cfg(test)]
pub(crate) mod testing;

#[cfg(test)]
mod test;
