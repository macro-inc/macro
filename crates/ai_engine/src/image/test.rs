use super::{DecodedImage, decode, expand_inline};
use crate::color::ColorSpace;
use crate::function::testing::{Mock, dict, obj, stream};
use crate::pdf::{Dict, Object, Stream};

const BLACK: [f32; 4] = [0.0, 0.0, 0.0, 1.0];

fn image(src: &str, data: &[u8]) -> DecodedImage {
    image_with(&Mock::default(), src, data)
}

fn image_with(mock: &Mock, src: &str, data: &[u8]) -> DecodedImage {
    decode(mock, &stream(src, data), &Dict::new(), BLACK).expect("image decodes")
}

fn pixel(img: &DecodedImage, x: u32, y: u32) -> [u8; 4] {
    let at = ((y * img.width + x) * 4) as usize;
    [
        img.rgba[at],
        img.rgba[at + 1],
        img.rgba[at + 2],
        img.rgba[at + 3],
    ]
}

#[track_caller]
fn assert_near(actual: [u8; 4], expected: [u8; 4], tolerance: u8) {
    assert!(
        actual
            .iter()
            .zip(&expected)
            .all(|(a, e)| a.abs_diff(*e) <= tolerance),
        "{actual:?} != {expected:?}"
    );
}

#[test]
fn rgb_8_bit() {
    let img = image(
        "<< /Width 2 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 >>",
        &[255, 0, 0, 10, 20, 30],
    );
    assert_eq!((img.width, img.height), (2, 1));
    assert_eq!(img.rgba, vec![255, 0, 0, 255, 10, 20, 30, 255]);
}

#[test]
fn gray_at_every_bit_depth() {
    let one = image(
        "<< /Width 3 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 1 >>",
        &[0b1010_0000],
    );
    assert_eq!(
        one.rgba,
        vec![255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]
    );
    let two = image(
        "<< /Width 4 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 2 >>",
        &[0b1110_0100],
    );
    let grays: Vec<u8> = two.rgba.chunks(4).map(|p| p[0]).collect();
    assert_eq!(grays, vec![255, 170, 85, 0]);
    let four = image(
        "<< /Width 3 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 4 >>",
        &[0xf0, 0x80],
    );
    let grays: Vec<u8> = four.rgba.chunks(4).map(|p| p[0]).collect();
    assert_eq!(grays, vec![255, 0, 136]);
    let sixteen = image(
        "<< /Width 2 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 16 >>",
        &[0xff, 0xff, 0x80, 0x00],
    );
    let grays: Vec<u8> = sixteen.rgba.chunks(4).map(|p| p[0]).collect();
    assert_eq!(grays, vec![255, 128]);
    // Rows are padded to whole bytes.
    let rows = image(
        "<< /Width 3 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 1 >>",
        &[0b1000_0000, 0b0010_0000],
    );
    let grays: Vec<u8> = rows.rgba.chunks(4).map(|p| p[0]).collect();
    assert_eq!(grays, vec![255, 0, 0, 0, 0, 255]);
}

#[test]
fn rgb_16_bit_and_cmyk() {
    let img = image(
        "<< /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 16 >>",
        &[0xff, 0xff, 0x80, 0x00, 0x00, 0x00],
    );
    assert_eq!(img.rgba, vec![255, 128, 0, 255]);
    let cmyk = image(
        "<< /Width 2 /Height 1 /ColorSpace /DeviceCMYK /BitsPerComponent 8 >>",
        &[0, 0, 0, 0, 255, 0, 0, 0],
    );
    assert_eq!(pixel(&cmyk, 0, 0), [255, 255, 255, 255]);
    let cyan = ColorSpace::Cmyk
        .to_rgb(&[1.0, 0.0, 0.0, 0.0])
        .map(|v| (v * 255.0 + 0.5) as u8);
    assert_eq!(pixel(&cmyk, 1, 0), [cyan[0], cyan[1], cyan[2], 255]);
}

#[test]
fn decode_arrays_invert_and_scale() {
    let inverted = image(
        "<< /Width 2 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Decode [1 0] >>",
        &[0, 255],
    );
    assert_eq!(inverted.rgba, vec![255, 255, 255, 255, 0, 0, 0, 255]);
    let half = image(
        "<< /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Decode [0 0.5 0 1 1 1] >>",
        &[255, 0, 0],
    );
    assert_eq!(half.rgba, vec![128, 0, 255, 255]);
    // An indexed image's Decode maps samples to indexes.
    let indexed = image(
        "<< /Width 2 /Height 1 /ColorSpace [/Indexed /DeviceRGB 1 <FF0000 0000FF>]
            /BitsPerComponent 1 /Decode [1 0] >>",
        &[0b0100_0000],
    );
    assert_eq!(indexed.rgba, vec![0, 0, 255, 255, 255, 0, 0, 255]);
}

#[test]
fn indexed_and_separation_images() {
    let indexed = image(
        "<< /Width 3 /Height 1 /ColorSpace [/Indexed /DeviceRGB 2 <FF0000 00FF00 0000FF>]
            /BitsPerComponent 8 >>",
        &[2, 0, 9],
    );
    assert_eq!(
        indexed.rgba,
        vec![0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 255, 255]
    );
    let none = image(
        "<< /Width 1 /Height 1 /BitsPerComponent 8
            /ColorSpace [/Separation /None /DeviceGray << /FunctionType 2 /Domain [0 1] /N 1 >>] >>",
        &[255],
    );
    assert_eq!(none.rgba[3], 0);
    let spot = image(
        "<< /Width 1 /Height 1 /BitsPerComponent 8
            /ColorSpace [/Separation /Black /DeviceGray << /FunctionType 2 /Domain [0 1] /C0 [1] /C1 [0] /N 1 >>] >>",
        &[255],
    );
    assert_eq!(spot.rgba, vec![0, 0, 0, 255]);
}

#[test]
fn color_spaces_resolve_through_resources() {
    let resources = dict("<< /ColorSpace << /CS0 /DeviceGray >> >>");
    let img = decode(
        &Mock::default(),
        &stream(
            "<< /Width 1 /Height 1 /ColorSpace /CS0 /BitsPerComponent 8 >>",
            &[51],
        ),
        &resources,
        BLACK,
    )
    .unwrap();
    assert_eq!(img.rgba, vec![51, 51, 51, 255]);
}

#[test]
fn stencil_masks_paint_the_fill() {
    let mock = Mock::default();
    let mask = stream("<< /Width 3 /Height 1 /ImageMask true >>", &[0b0110_0000]);
    let fill = [1.0, 0.0, 0.0, 0.5];
    let img = decode(&mock, &mask, &Dict::new(), fill).unwrap();
    assert_eq!(pixel(&img, 0, 0), [255, 0, 0, 128]);
    assert_eq!(pixel(&img, 1, 0), [255, 0, 0, 0]);
    assert_eq!(pixel(&img, 2, 0), [255, 0, 0, 0]);
    // Decode [1 0]: ones mark.
    let inverted = stream(
        "<< /Width 3 /Height 1 /ImageMask true /BitsPerComponent 1 /Decode [1 0] >>",
        &[0b0110_0000],
    );
    let img = decode(&mock, &inverted, &Dict::new(), [0.0, 0.0, 1.0, 1.0]).unwrap();
    assert_eq!(pixel(&img, 0, 0)[3], 0);
    assert_eq!(pixel(&img, 1, 0), [0, 0, 255, 255]);
    assert_eq!(pixel(&img, 2, 0), [0, 0, 255, 255]);
}

#[test]
fn soft_masks_and_matte() {
    let mut mock = Mock::default();
    mock.add(
        1,
        Object::Stream(stream(
            "<< /Width 2 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 >>",
            &[255, 128],
        )),
    );
    let img = image_with(
        &mock,
        "<< /Width 2 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 1 0 R >>",
        &[10, 20, 30, 40, 50, 60],
    );
    assert_eq!(img.rgba, vec![10, 20, 30, 255, 40, 50, 60, 128]);
    // Colors premultiplied with a black matte are restored.
    mock.add(
        2,
        Object::Stream(stream(
            "<< /Width 2 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Matte [0 0 0] >>",
            &[255, 128],
        )),
    );
    let img = image_with(
        &mock,
        "<< /Width 2 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 2 0 R >>",
        &[10, 20, 30, 128, 64, 0],
    );
    assert_eq!(pixel(&img, 0, 0), [10, 20, 30, 255]);
    assert_near(pixel(&img, 1, 0), [255, 128, 0, 128], 1);
    // A soft mask of another size is resampled.
    mock.add(
        3,
        Object::Stream(stream(
            "<< /Width 1 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 >>",
            &[0, 255],
        )),
    );
    let img = image_with(
        &mock,
        "<< /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /SMask 3 0 R >>",
        &[1, 2, 3, 4],
    );
    let alphas: Vec<u8> = img.rgba.chunks(4).map(|p| p[3]).collect();
    assert_eq!(alphas, vec![0, 0, 255, 255]);
}

#[test]
fn color_key_masks() {
    let img = image(
        "<< /Width 3 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8
            /Mask [250 255 0 5 0 5] >>",
        &[255, 0, 0, 255, 6, 0, 0, 0, 0],
    );
    let alphas: Vec<u8> = img.rgba.chunks(4).map(|p| p[3]).collect();
    assert_eq!(alphas, vec![0, 255, 255]);
    // Indexed images key on the index.
    let img = image(
        "<< /Width 2 /Height 1 /ColorSpace [/Indexed /DeviceGray 1 <00FF>]
            /BitsPerComponent 8 /Mask [1 1] >>",
        &[0, 1],
    );
    let alphas: Vec<u8> = img.rgba.chunks(4).map(|p| p[3]).collect();
    assert_eq!(alphas, vec![255, 0]);
}

#[test]
fn explicit_masks_of_another_size() {
    let mut mock = Mock::default();
    // 2 × 2 stencil over a 4 × 4 image: the right column is masked out.
    mock.add(
        1,
        Object::Stream(stream(
            "<< /Width 2 /Height 2 /ImageMask true >>",
            &[0b0100_0000, 0b0100_0000],
        )),
    );
    let img = image_with(
        &mock,
        "<< /Width 4 /Height 4 /ColorSpace /DeviceGray /BitsPerComponent 8 /Mask 1 0 R >>",
        &[200; 16],
    );
    for y in 0..4 {
        let alphas: Vec<u8> = (0..4).map(|x| pixel(&img, x, y)[3]).collect();
        assert_eq!(alphas, vec![255, 255, 0, 0], "row {y}");
    }
}

#[test]
fn short_data_reads_as_zeros_and_limits_hold() {
    let img = image(
        "<< /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 >>",
        &[255, 255],
    );
    let grays: Vec<u8> = img.rgba.chunks(4).map(|p| p[0]).collect();
    assert_eq!(grays, vec![255, 255, 0, 0]);
    let mock = Mock::default();
    for bad in [
        "<< /Width 100000 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 >>",
        "<< /Width 20000 /Height 20000 /ColorSpace /DeviceGray /BitsPerComponent 8 >>",
        "<< /Width 0 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 >>",
        "<< /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 >>",
        "<< /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 3 >>",
        "<< /Width 1 /Height 1 /ColorSpace /Pattern /BitsPerComponent 8 >>",
    ] {
        assert!(
            decode(&mock, &stream(bad, &[0]), &Dict::new(), BLACK).is_err(),
            "{bad}"
        );
    }
}

#[test]
fn unsupported_codecs_give_a_placeholder() {
    for filter in ["/JPXDecode", "/JBIG2Decode"] {
        let img = image(
            &format!(
                "<< /Width 3 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter {filter} >>"
            ),
            b"not decoded",
        );
        assert_eq!((img.width, img.height), (3, 2));
        assert!(img.rgba.chunks(4).all(|p| p == [128, 128, 128, 255]));
    }
}

#[test]
fn dct_rgb_round_trips_through_the_encoder() {
    // Four flat 8 × 8 quadrants.
    let colors = [
        [220u8, 30, 40],
        [30, 200, 60],
        [20, 40, 210],
        [240, 240, 240],
    ];
    let (w, h) = (16u32, 16u32);
    let mut rgba = Vec::new();
    for y in 0..h {
        for x in 0..w {
            let c = colors[((y / 8) * 2 + x / 8) as usize];
            rgba.extend_from_slice(&[c[0], c[1], c[2], 255]);
        }
    }
    let jpeg = fig_engine::export::jpeg::encode(&rgba, w, h, 95);
    let img = image(
        "<< /Width 16 /Height 16 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode >>",
        &jpeg,
    );
    assert_eq!((img.width, img.height), (16, 16));
    for (i, c) in colors.iter().enumerate() {
        let (x, y) = ((i as u32 % 2) * 8 + 4, (i as u32 / 2) * 8 + 4);
        assert_near(pixel(&img, x, y), [c[0], c[1], c[2], 255], 6);
    }
}

/// A baseline JPEG of flat 8 × 8 blocks (DC coefficients only, no
/// subsampling): `value(block x, block y, component)` per block.
fn flat_jpeg(
    blocks: (usize, usize),
    ids: &[u8],
    adobe: Option<u8>,
    value: impl Fn(usize, usize, usize) -> u8,
) -> Vec<u8> {
    let comps = ids.len();
    let (bw, bh) = blocks;
    let mut out = vec![0xff, 0xd8];
    let segment = |out: &mut Vec<u8>, marker: u8, body: &[u8]| {
        out.extend_from_slice(&[0xff, marker]);
        out.extend_from_slice(&((body.len() + 2) as u16).to_be_bytes());
        out.extend_from_slice(body);
    };
    if let Some(transform) = adobe {
        segment(
            &mut out,
            0xee,
            &[b'A', b'd', b'o', b'b', b'e', 0, 100, 0, 0, 0, 0, transform],
        );
    }
    let mut dqt = vec![0];
    dqt.extend([1u8; 64]);
    segment(&mut out, 0xdb, &dqt);
    let mut sof = vec![8];
    sof.extend_from_slice(&((bh * 8) as u16).to_be_bytes());
    sof.extend_from_slice(&((bw * 8) as u16).to_be_bytes());
    sof.push(comps as u8);
    for &id in ids {
        sof.extend_from_slice(&[id, 0x11, 0]);
    }
    segment(&mut out, 0xc0, &sof);
    let dc_bits = [0u8, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
    let mut dht = vec![0x00];
    dht.extend_from_slice(&dc_bits);
    dht.extend(0u8..12);
    segment(&mut out, 0xc4, &dht);
    let mut ac = vec![0x10, 1];
    ac.extend([0u8; 15]);
    ac.push(0x00);
    segment(&mut out, 0xc4, &ac);
    let mut sos = vec![comps as u8];
    for &id in ids {
        sos.extend_from_slice(&[id, 0x00]);
    }
    sos.extend_from_slice(&[0, 63, 0]);
    segment(&mut out, 0xda, &sos);
    // Canonical codes for the DC categories.
    let mut codes = Vec::new();
    let mut code = 0u32;
    for (len, &count) in dc_bits.iter().enumerate() {
        for _ in 0..count {
            codes.push((code, len as u32 + 1));
            code += 1;
        }
        code <<= 1;
    }
    let mut bits = Vec::new();
    let mut put = |value: u32, len: u32| {
        for i in (0..len).rev() {
            bits.push((value >> i) & 1 == 1);
        }
    };
    let mut previous = vec![0i32; comps];
    for by in 0..bh {
        for bx in 0..bw {
            for (c, previous) in previous.iter_mut().enumerate() {
                let dc = 8 * (i32::from(value(bx, by, c)) - 128);
                let diff = dc - *previous;
                *previous = dc;
                let category = 32 - diff.unsigned_abs().leading_zeros();
                let (code, len) = codes[category as usize];
                put(code, len);
                if category > 0 {
                    let v = if diff > 0 {
                        diff
                    } else {
                        diff + (1 << category) - 1
                    };
                    put(v as u32, category);
                }
                // End of block.
                put(0, 1);
            }
        }
    }
    while bits.len() % 8 != 0 {
        bits.push(true);
    }
    for byte in bits.chunks(8) {
        let b = byte
            .iter()
            .fold(0u8, |acc, &bit| (acc << 1) | u8::from(bit));
        out.push(b);
        if b == 0xff {
            out.push(0);
        }
    }
    out.extend_from_slice(&[0xff, 0xd9]);
    out
}

#[test]
fn dct_gray_with_a_decode_array() {
    let jpeg = flat_jpeg((2, 1), &[1], None, |bx, _, _| if bx == 0 { 0 } else { 200 });
    let img = image(
        "<< /Width 16 /Height 8 /ColorSpace /DeviceGray /BitsPerComponent 8
            /Filter /DCTDecode /Decode [1 0] >>",
        &jpeg,
    );
    assert_near(pixel(&img, 3, 3), [255, 255, 255, 255], 1);
    assert_near(pixel(&img, 12, 3), [55, 55, 55, 255], 1);
}

#[test]
fn dct_adobe_inverted_cmyk() {
    // Photoshop stores CMYK inverted, with Decode [1 0 …] in the PDF.
    let ink = [[255u8, 0, 0, 0], [0, 0, 0, 255]];
    let jpeg = flat_jpeg((2, 1), &[1, 2, 3, 4], Some(0), |bx, _, c| 255 - ink[bx][c]);
    let img = image(
        "<< /Width 16 /Height 8 /ColorSpace /DeviceCMYK /BitsPerComponent 8
            /Filter /DCTDecode /Decode [1 0 1 0 1 0 1 0] >>",
        &jpeg,
    );
    for (bx, ink) in ink.iter().enumerate() {
        let values = ink.map(|v| f32::from(v) / 255.0);
        let rgb = ColorSpace::Cmyk
            .to_rgb(&values)
            .map(|v| (v * 255.0 + 0.5) as u8);
        assert_near(
            pixel(&img, bx as u32 * 8 + 4, 4),
            [rgb[0], rgb[1], rgb[2], 255],
            2,
        );
    }
}

#[test]
fn dct_ycck() {
    // YCCK: inverted CMY stored as YCbCr of RGB = 255 - CMY, K as is.
    let stored = [0u8, 255, 255, 255];
    let (r, g, b) = (
        f32::from(255 - stored[0]),
        f32::from(255 - stored[1]),
        f32::from(255 - stored[2]),
    );
    let y = 0.299 * r + 0.587 * g + 0.114 * b;
    let cb = 128.0 - 0.168_736 * r - 0.331_264 * g + 0.5 * b;
    let cr = 128.0 + 0.5 * r - 0.418_688 * g - 0.081_312 * b;
    let ycck = [y, cb, cr, f32::from(stored[3])].map(|v| v.round().clamp(0.0, 255.0) as u8);
    let jpeg = flat_jpeg((1, 1), &[1, 2, 3, 4], Some(2), |_, _, c| ycck[c]);
    let img = image(
        "<< /Width 8 /Height 8 /ColorSpace /DeviceCMYK /BitsPerComponent 8
            /Filter /DCTDecode /Decode [1 0 1 0 1 0 1 0] >>",
        &jpeg,
    );
    // Full cyan, no other ink.
    let cyan = ColorSpace::Cmyk
        .to_rgb(&[1.0, 0.0, 0.0, 0.0])
        .map(|v| (v * 255.0 + 0.5) as u8);
    assert_near(pixel(&img, 4, 4), [cyan[0], cyan[1], cyan[2], 255], 3);
}

#[test]
fn dct_color_transform_parameter_and_rgb_ids() {
    // Three components stored as RGB: ids spelling RGB, or ColorTransform 0.
    let rgb = [200u8, 100, 50];
    let by_ids = flat_jpeg((1, 1), b"RGB", None, |_, _, c| rgb[c]);
    let img = image(
        "<< /Width 8 /Height 8 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode >>",
        &by_ids,
    );
    assert_near(pixel(&img, 4, 4), [200, 100, 50, 255], 1);
    let by_param = flat_jpeg((1, 1), &[1, 2, 3], None, |_, _, c| rgb[c]);
    let img = image(
        "<< /Width 8 /Height 8 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode
            /DecodeParms << /ColorTransform 0 >> >>",
        &by_param,
    );
    assert_near(pixel(&img, 4, 4), [200, 100, 50, 255], 1);
    // Damaged data fails rather than panicking.
    let mock = Mock::default();
    let broken = stream(
        "<< /Width 8 /Height 8 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode >>",
        &by_param[..by_param.len() / 2],
    );
    let _ = decode(&mock, &broken, &Dict::new(), BLACK);
    let garbage = stream(
        "<< /Width 8 /Height 8 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode >>",
        b"\xff\xd8\xff\xc0\x00",
    );
    assert!(decode(&mock, &garbage, &Dict::new(), BLACK).is_err());
}

#[test]
fn ccitt_group_3_one_dimensional() {
    // Row 1: 2 white, 4 black, 2 white; row 2: 8 white.
    let img = image(
        "<< /Width 8 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 1
            /Filter /CCITTFaxDecode /DecodeParms << /K 0 /Columns 8 >> >>",
        &[0x76, 0xf3],
    );
    let grays: Vec<u8> = img.rgba.chunks(4).map(|p| p[0]).collect();
    let expected = vec![
        255, 255, 0, 0, 0, 0, 255, 255, //
        255, 255, 255, 255, 255, 255, 255, 255,
    ];
    assert_eq!(grays, expected);
    // The same rows byte-aligned: fill zeros before each end of line so it
    // ends on a byte boundary (one fill bit after the first row).
    let img = image(
        "<< /Width 8 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 1
            /Filter /CCITTFaxDecode
            /DecodeParms << /K 0 /Columns 8 /EncodedByteAlign true /EndOfLine true >> >>",
        &[0x00, 0x01, 0x76, 0xe0, 0x01, 0x98, 0x00, 0x01],
    );
    let grays: Vec<u8> = img.rgba.chunks(4).map(|p| p[0]).collect();
    assert_eq!(grays, expected);
}

#[test]
fn ccitt_group_4() {
    // Two rows of 2 white, 4 black, 2 white, then an end of block.
    let data = [0x2e, 0xfc, 0x00, 0x40, 0x04];
    let img = image(
        "<< /Width 8 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 1
            /Filter /CCITTFaxDecode /DecodeParms << /K -1 /Columns 8 >> >>",
        &data,
    );
    let grays: Vec<u8> = img.rgba.chunks(4).map(|p| p[0]).collect();
    let row = [255, 255, 0, 0, 0, 0, 255, 255];
    assert_eq!(grays, [row, row].concat());
    // BlackIs1 flips the bits, which Decode [1 0] flips back.
    let img = image(
        "<< /Width 8 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 1 /Decode [1 0]
            /Filter /CCITTFaxDecode /DecodeParms << /K -1 /Columns 8 /BlackIs1 true >> >>",
        &data,
    );
    let grays: Vec<u8> = img.rgba.chunks(4).map(|p| p[0]).collect();
    assert_eq!(grays, [row, row].concat());
    // As a stencil: black marks.
    let mask = decode(
        &Mock::default(),
        &stream(
            "<< /Width 8 /Height 2 /ImageMask true
                /Filter /CCITTFaxDecode /DecodeParms << /K -1 /Columns 8 >> >>",
            &data,
        ),
        &Dict::new(),
        BLACK,
    )
    .unwrap();
    let alphas: Vec<u8> = mask.rgba.chunks(4).map(|p| p[3]).collect();
    assert_eq!(&alphas[..8], &[0, 0, 255, 255, 255, 255, 0, 0]);
    // Missing rows are white.
    let img = image(
        "<< /Width 8 /Height 4 /ColorSpace /DeviceGray /BitsPerComponent 1
            /Filter /CCITTFaxDecode /DecodeParms << /K -1 /Columns 8 >> >>",
        &data,
    );
    assert_eq!(pixel(&img, 3, 3), [255, 255, 255, 255]);
}

#[test]
fn inline_images_expand_abbreviations() {
    let expanded = expand_inline(&dict(
        "<< /W 4 /H 2 /BPC 8 /CS /RGB /F [/AHx /Fl] /DP << /Predictor 15 >>
            /IM false /D [1 0] /I true /Extra 1 >>",
    ));
    assert_eq!(
        expanded,
        dict(
            "<< /Width 4 /Height 2 /BitsPerComponent 8 /ColorSpace /DeviceRGB
                /Filter [/ASCIIHexDecode /FlateDecode] /DecodeParms << /Predictor 15 >>
                /ImageMask false /Decode [1 0] /Interpolate true /Extra 1 >>"
        )
    );
    let filters = expand_inline(&dict("<< /F /DCT >>"));
    assert_eq!(filters.get("Filter"), Some(&obj("/DCTDecode")));
    for (short, long) in [
        ("/A85", "/ASCII85Decode"),
        ("/LZW", "/LZWDecode"),
        ("/RL", "/RunLengthDecode"),
        ("/CCF", "/CCITTFaxDecode"),
    ] {
        let d = expand_inline(&dict(&format!("<< /F {short} >>")));
        assert_eq!(d.get("Filter"), Some(&obj(long)));
    }
    let gray = expand_inline(&dict("<< /CS /G >>"));
    assert_eq!(gray.get("ColorSpace"), Some(&obj("/DeviceGray")));
    let cmyk = expand_inline(&dict("<< /CS /CMYK >>"));
    assert_eq!(cmyk.get("ColorSpace"), Some(&obj("/DeviceCMYK")));
    // Indexed with an abbreviated base; resource names are kept.
    let indexed = expand_inline(&dict("<< /CS [/I /RGB 1 <FF000000FF00>] >>"));
    assert_eq!(
        indexed.get("ColorSpace"),
        Some(&obj("[/Indexed /DeviceRGB 1 <FF000000FF00>]"))
    );
    let named = expand_inline(&dict("<< /CS /CS0 >>"));
    assert_eq!(named.get("ColorSpace"), Some(&obj("/CS0")));
    // An expanded inline image decodes.
    let inline = expand_inline(&dict(
        "<< /W 2 /H 1 /BPC 8 /CS [/I /RGB 1 <FF000000FF00>] >>",
    ));
    let img = decode(
        &Mock::default(),
        &Stream::new(inline, vec![1, 0]),
        &Dict::new(),
        BLACK,
    )
    .unwrap();
    assert_eq!(img.rgba, vec![0, 255, 0, 255, 255, 0, 0, 255]);
}

#[test]
fn garbage_images_never_panic() {
    use crate::function::testing::Noise;
    let mut noise = Noise(11);
    let mut mock = Mock::default();
    mock.add(
        1,
        Object::Stream(stream(
            "<< /FunctionType 4 /Domain [0 1 0 1] /Range [0 1 0 1 0 1 0 1] >>",
            b"{ 0 0 }",
        )),
    );
    let spaces = [
        "/DeviceGray",
        "/DeviceRGB",
        "/DeviceCMYK",
        "[/Indexed /DeviceRGB 7 <FF00>]",
        "[/Lab << /WhitePoint [0.95 1 1.09] >>]",
        "[/Separation /Spot /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C1 [0 1 0 0] /N 1 >>]",
        "[/DeviceN [/A /B] /DeviceCMYK 1 0 R]",
    ];
    let jpegs = [
        flat_jpeg((2, 2), &[1], None, |x, y, _| (x * 90 + y * 40) as u8),
        flat_jpeg((2, 1), &[1, 2, 3, 4], Some(2), |x, _, c| {
            (x * 50 + c * 30) as u8
        }),
        fig_engine::export::jpeg::encode(&[200; 16 * 16 * 4], 16, 16, 80),
    ];
    // Images decoded, by kind of data (JPEG, fax, raw, raw).
    let mut decoded = [0; 4];
    for round in 0..300 {
        let (w, h) = (1 + noise.below(24), 1 + noise.below(24));
        let bits = *noise.pick(&[1, 2, 4, 8, 16]);
        let cs = *noise.pick(&spaces);
        let decode_array = if noise.below(3) == 0 {
            "/Decode [1 0 0.5 0.25 9 -9 0 1 1 0]"
        } else {
            ""
        };
        let mask = match noise.below(4) {
            0 => "/Mask [0 3 1 1 0 255 2 2]",
            1 => "/SMask 2 0 R",
            2 => "/Mask 3 0 R",
            _ => "",
        };
        let len = noise.below(w * h * 8 + 4) as usize;
        let smask_len = noise.below(40) as usize;
        let smask = noise.bytes(smask_len);
        mock.add(
            2,
            Object::Stream(stream(
                &format!(
                    "<< /Width {} /Height {} /BitsPerComponent 8 /ColorSpace /DeviceGray /Matte [0 0 0 0] >>",
                    1 + noise.below(9),
                    1 + noise.below(9)
                ),
                &smask,
            )),
        );
        let stencil_len = noise.below(12) as usize;
        let stencil = noise.bytes(stencil_len);
        mock.add(
            3,
            Object::Stream(stream(
                &format!(
                    "<< /Width {} /Height {} /ImageMask true >>",
                    1 + noise.below(30),
                    1 + noise.below(30)
                ),
                &stencil,
            )),
        );
        let (filter, data) = match round % 4 {
            // A damaged JPEG.
            0 => {
                // Damage mostly in the coded data after the headers.
                let mut j = noise.pick(&jpegs).clone();
                let tail = j.len() * 3 / 5;
                for _ in 0..noise.below(4) {
                    let at = tail + noise.below((j.len() - tail) as u64) as usize;
                    j[at] = noise.next() as u8;
                }
                if noise.below(4) == 0 {
                    j.truncate(noise.below(j.len() as u64 + 1) as usize);
                }
                ("/Filter /DCTDecode".to_string(), j)
            }
            // Fax data.
            1 => (
                format!(
                    "/Filter /CCITTFaxDecode /DecodeParms << /K {} /Columns {w} /EncodedByteAlign {} /EndOfLine {} >>",
                    noise.below(4) as i64 - 1,
                    noise.below(2) == 0,
                    noise.below(2) == 0
                ),
                noise.bytes(len),
            ),
            _ => (String::new(), noise.bytes(len)),
        };
        let image_mask = if noise.below(8) == 0 {
            "/ImageMask true"
        } else {
            ""
        };
        let src = format!(
            "<< /Width {w} /Height {h} /BitsPerComponent {bits} /ColorSpace {cs} {decode_array} {mask}
                {filter} {image_mask} >>"
        );
        let Ok(img) = decode(&mock, &stream(&src, &data), &Dict::new(), BLACK) else {
            continue;
        };
        decoded[round % 4] += 1;
        assert_eq!(
            img.rgba.len(),
            img.width as usize * img.height as usize * 4,
            "{src}"
        );
    }
    // Every kind of data got through to a picture often enough.
    assert!(decoded.iter().all(|&n| n > 10), "{decoded:?}");
}

/// Decodes fax data written by libtiff (through Pillow; see
/// `GRAPHICS_CORPUS_DIR`) and compares it with libtiff's own decoding.
#[test]
#[ignore = "needs GRAPHICS_CORPUS_DIR, exported from local corpora"]
fn corpus_fax_matches_libtiff() {
    use crate::function::testing::corpus_manifest;
    let Some((dir, entries)) = corpus_manifest() else {
        return;
    };
    for e in entries.iter().filter(|e| e["kind"] == "fax") {
        let data = std::fs::read(dir.join(e["data"].as_str().unwrap_or_default())).unwrap();
        let expected = std::fs::read(dir.join(e["expected"].as_str().unwrap_or_default())).unwrap();
        let (w, h, k) = (
            e["w"].as_u64().unwrap(),
            e["h"].as_u64().unwrap(),
            e["K"].as_i64().unwrap(),
        );
        let align = e["byte_align"].as_bool().unwrap_or(false);
        // libtiff codes zero bits as white runs whatever the photometric
        // interpretation; MinIsBlack (1) images therefore come out inverted.
        let decode = if e["photometric"] == 1 {
            "[1 0]"
        } else {
            "[0 1]"
        };
        let img = image(
            &format!(
                "<< /Width {w} /Height {h} /ColorSpace /DeviceGray /BitsPerComponent 1
                    /Decode {decode} /Filter /CCITTFaxDecode
                    /DecodeParms << /K {k} /Columns {w} /Rows {h} /EncodedByteAlign {align} >> >>"
            ),
            &data,
        );
        let gray: Vec<u8> = img.rgba.chunks(4).map(|p| p[0]).collect();
        let same = gray.iter().zip(&expected).filter(|(a, b)| a == b).count();
        let first_bad = gray
            .iter()
            .zip(&expected)
            .position(|(a, b)| a != b)
            .map(|i| (i % w as usize, i / w as usize));
        println!(
            "{}: {same} of {} pixels agree, first difference at {first_bad:?}",
            e["data"],
            expected.len()
        );
        assert_eq!(same, expected.len());
    }
}

/// Differences between two runs of values: the mean, and the share (%)
/// more than 8 apart.
fn differences(pairs: impl Iterator<Item = (u8, u8)>) -> (f64, f64) {
    let (mut count, mut total, mut far) = (0u64, 0u64, 0u64);
    for (a, b) in pairs {
        let d = a.abs_diff(b);
        count += 1;
        total += u64::from(d);
        far += u64::from(d > 8);
    }
    let count = count.max(1) as f64;
    (total as f64 / count, far as f64 / count * 100.0)
}

/// Decodes the corpus's images (exported with MuPDF's decoded samples;
/// see `GRAPHICS_CORPUS_DIR`) and compares colors and soft-mask alpha.
#[test]
#[ignore = "needs GRAPHICS_CORPUS_DIR, exported from local corpora"]
fn corpus_images_match_references() {
    use crate::function::testing::{Corpus, corpus_manifest};
    use crate::pdf::{ObjRef, Resolve};
    let Some((dir, entries)) = corpus_manifest() else {
        return;
    };
    for e in entries.iter().filter(|e| e["kind"] == "image") {
        let name = e["dir"].as_str().unwrap_or_default();
        let xref = e["xref"].as_u64().unwrap_or_default() as u32;
        let (w, h) = (
            e["w"].as_u64().unwrap_or_default() as u32,
            e["h"].as_u64().unwrap_or_default() as u32,
        );
        let n = e["n"].as_u64().unwrap_or_default() as usize;
        let cs = e["cs"].as_str().unwrap_or_default();
        let corpus = Corpus {
            dir: dir.join(name),
        };
        let object = corpus.resolve(&Object::Ref(ObjRef::new(xref, 0)));
        let Some(stream) = object.as_stream() else {
            println!("{name} {xref}: not a stream");
            continue;
        };
        let start = std::time::Instant::now();
        let img = match decode(&corpus, stream, &Dict::new(), BLACK) {
            Ok(img) => img,
            Err(err) => {
                println!("{name} {xref}: does not decode: {err}");
                continue;
            }
        };
        let took = start.elapsed();
        if (img.width, img.height) != (w, h) {
            println!(
                "{name} {xref}: {}x{} decoded, {w}x{h} expected",
                img.width, img.height
            );
            continue;
        }
        let samples = std::fs::read(dir.join(e["ref"].as_str().unwrap_or_default())).unwrap();
        // MuPDF keeps separations as tints: convert those through the
        // image's own space.
        let own = ColorSpace::parse(
            &corpus,
            stream.dict.get("ColorSpace").unwrap_or(&Object::Null),
            &Dict::new(),
        )
        .ok();
        let expected: Vec<[u8; 3]> = samples
            .chunks_exact(n)
            .map(|s| {
                if cs.starts_with("Separation")
                    && let Some(own) = &own
                {
                    own.to_rgb(&[f32::from(s[0]) / 255.0])
                        .map(|c| (c * 255.0 + 0.5) as u8)
                } else if cs.contains("CMYK") && n >= 4 {
                    let v = [s[0], s[1], s[2], s[3]].map(|c| f32::from(c) / 255.0);
                    ColorSpace::Cmyk.to_rgb(&v).map(|c| (c * 255.0 + 0.5) as u8)
                } else if cs.contains("RGB") {
                    [s[0], s[1], s[2]]
                } else {
                    [s[0]; 3]
                }
            })
            .collect();
        let (mean, far) = differences(
            img.rgba
                .chunks_exact(4)
                .zip(&expected)
                .flat_map(|(a, b)| (0..3).map(move |k| (a[k], b[k]))),
        );
        let mut line =
            format!("{name} {xref} {cs} {w}x{h}: color mean diff {mean:.2}, >8 off {far:.2}%");
        if let Some(smask) = e.get("smask") {
            let alpha = std::fs::read(dir.join(smask["ref"].as_str().unwrap_or_default()))
                .unwrap_or_default();
            let (sw, sh) = (
                smask["w"].as_u64().unwrap_or(1) as usize,
                smask["h"].as_u64().unwrap_or(1) as usize,
            );
            let (mean, far) = differences((0..h as usize).flat_map(|y| {
                let alpha = &alpha;
                let rgba = &img.rgba;
                (0..w as usize).map(move |x| {
                    let sx = (x * 2 + 1) * sw / (w as usize * 2);
                    let sy = (y * 2 + 1) * sh / (h as usize * 2);
                    let a = alpha.get(sy * sw + sx).copied().unwrap_or(255);
                    (rgba[(y * w as usize + x) * 4 + 3], a)
                })
            }));
            line += &format!(", alpha mean diff {mean:.2}, >8 off {far:.2}%");
        }
        println!("{line}, {took:?}");
    }
}
