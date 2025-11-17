use anyhow::Result;
use base64::Engine;
use base64::engine::general_purpose;
use image::{DynamicImage, GenericImageView};
use webp::Encoder;

pub fn make_compressed_base64_webp(image_bytes: &[u8]) -> Result<String> {
    let img = image::load_from_memory(image_bytes)?;
    let resized_img = resize_if_needed(img, 1080, 720);
    let rgb_img = resized_img.to_rgb8();
    let encoder = Encoder::from_rgb(&rgb_img, rgb_img.width(), rgb_img.height());
    let webp_data = encoder.encode(75.0);
    let base64_string = general_purpose::STANDARD.encode(&*webp_data);
    Ok(format!("data:image/webp;base64,{}", base64_string))
}

fn resize_if_needed(img: DynamicImage, max_width: u32, max_height: u32) -> DynamicImage {
    let (width, height) = img.dimensions();

    // Check if resize is needed
    if width <= max_width && height <= max_height {
        return img;
    }

    // Calculate new dimensions while maintaining aspect ratio
    let width_ratio = max_width as f32 / width as f32;
    let height_ratio = max_height as f32 / height as f32;
    let ratio = width_ratio.min(height_ratio);

    let new_width = (width as f32 * ratio) as u32;
    let new_height = (height as f32 * ratio) as u32;

    img.resize(new_width, new_height, image::imageops::FilterType::Lanczos3)
}
