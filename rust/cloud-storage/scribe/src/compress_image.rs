use anyhow::Result;
use base64::Engine;
use base64::engine::general_purpose;
use image::{DynamicImage, GenericImageView};
use webp::Encoder;

const ENCODING_QUALITY: f32 = 75.0;
const MAX_SIZE_W: u32 = 1080;
const MAX_SIZE_H: u32 = 720;

pub fn make_compressed_base64_webp(image_bytes: &[u8]) -> Result<String> {
    let img = image::load_from_memory(image_bytes)?;
    let resized_img = resize_if_needed(img);
    let rgb_img = resized_img.to_rgb8();
    let encoder = Encoder::from_rgb(&rgb_img, rgb_img.width(), rgb_img.height());
    let webp_data = encoder.encode(ENCODING_QUALITY);
    let base64_string = general_purpose::STANDARD.encode(&*webp_data);
    Ok(format!("data:image/webp;base64,{}", base64_string))
}

fn resize_if_needed(img: DynamicImage) -> DynamicImage {
    let (width, height) = img.dimensions();

    // Check if resize is needed
    if width <= MAX_SIZE_W && height <= MAX_SIZE_H {
        return img;
    }

    // Calculate new dimensions while maintaining aspect ratio
    let width_ratio = MAX_SIZE_W as f32 / width as f32;
    let height_ratio = MAX_SIZE_H as f32 / height as f32;
    let ratio = width_ratio.min(height_ratio);

    let new_width = (width as f32 * ratio) as u32;
    let new_height = (height as f32 * ratio) as u32;

    img.resize(new_width, new_height, image::imageops::FilterType::Lanczos3)
}
