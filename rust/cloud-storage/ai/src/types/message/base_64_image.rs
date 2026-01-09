use anyhow::{anyhow, bail};
use base64::Engine;
use base64::engine::general_purpose;
use image::{DynamicImage, GenericImageView};
use model_file_type::FileType;
use webp::Encoder;

const ENCODING_QUALITY: f32 = 75.0;
const MAX_SIZE_W: u32 = 1080;
const MAX_SIZE_H: u32 = 720;

#[derive(Eq, PartialEq, Clone)]
pub struct Base64Image {
    data: String,
    format: ImageFormat,
}

#[derive(Clone, Debug, Copy, Eq, PartialEq)]
pub enum ImageFormat {
    WebP,
    Jpg,
    Jpeg,
    Png,
}

impl TryFrom<FileType> for ImageFormat {
    type Error = anyhow::Error;
    fn try_from(value: FileType) -> Result<Self, Self::Error> {
        match value {
            FileType::Jpg => Ok(Self::Jpg),
            FileType::Jpeg => Ok(Self::Jpeg),
            FileType::Png => Ok(Self::Png),
            FileType::Webp => Ok(Self::WebP),
            _ => bail!("No conversion"),
        }
    }
}

impl Base64Image {
    pub fn compress_and_reencode(bytes: Vec<u8>) -> Result<Self, anyhow::Error> {
        Self::make_compressed_base64_webp(bytes)
    }

    pub(crate) fn dangerously_try_from_string(s: String) -> Result<Self, anyhow::Error> {
        let prefix = s.split_once(";").ok_or(anyhow!("Unexpected format"))?.0;
        let image = prefix
            .split_once("/")
            .ok_or(anyhow!("Unexpected format"))?
            .1;
        let format = ImageFormat::try_from(image)?;
        Ok(Self { data: s, format })
    }
}

impl Base64Image {
    fn prefix(&self) -> String {
        format!("data:image/{};base64,", self.format)
    }
}

impl std::fmt::Display for Base64Image {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}{}", self.prefix(), self.data)
    }
}

impl std::fmt::Display for ImageFormat {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}",
            match self {
                Self::WebP => "webp",
                Self::Jpg => "jpg",
                Self::Jpeg => "jpeg",
                Self::Png => "png",
            }
        )
    }
}

impl std::fmt::Debug for Base64Image {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}[{} bytes]", self.prefix(), self.data.len())
    }
}

impl Base64Image {
    fn make_compressed_base64_webp(image_bytes: Vec<u8>) -> Result<Self, anyhow::Error> {
        let img = image::load_from_memory(&image_bytes)?;
        let resized_img = Self::resize_if_needed(img);
        let rgb_img = resized_img.to_rgb8();
        let encoder = Encoder::from_rgb(&rgb_img, rgb_img.width(), rgb_img.height());
        let webp_data = encoder.encode(ENCODING_QUALITY);
        let base64_string = general_purpose::STANDARD.encode(&*webp_data);
        Ok(Self {
            data: base64_string,
            format: ImageFormat::WebP,
        })
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
}

impl From<ImageFormat> for image::ImageFormat {
    fn from(value: ImageFormat) -> Self {
        match value {
            ImageFormat::Jpeg => Self::Jpeg,
            ImageFormat::Jpg => Self::Jpeg,
            ImageFormat::WebP => Self::WebP,
            ImageFormat::Png => Self::Png,
        }
    }
}

impl TryFrom<&str> for ImageFormat {
    type Error = anyhow::Error;
    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "webp" => Ok(Self::WebP),
            "jpg" => Ok(Self::Jpg),
            "jpeg" => Ok(Self::Jpeg),
            "png" => Ok(Self::Png),
            _ => bail!("No conversion"),
        }
    }
}
