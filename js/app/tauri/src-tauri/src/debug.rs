#![allow(dead_code)]
use super::*;

#[derive(Debug)]
pub enum CopyCookieOutcome {
    NoCookieFoundForSrc(Url),
    SetCookies(Vec<HeaderValue>),
}

/// side effects mutates the persisted cookie storage by writing to the destination
#[tracing::instrument(ret, skip(handle), level = tracing::Level::DEBUG)]
pub fn debug_copy_cookies_to_origin<R: Runtime>(
    handle: &AppHandle<R>,
    src: Url,
    dest: &Url,
) -> CopyCookieOutcome {
    let state = handle.try_state::<tauri_plugin_http::Http>().expect("No http plugin state was found, either you called this fn to early, or the http plugin is not installed");
    let jar = state.inner().cookies_jar.as_ref();
    let Some(header) = jar.cookies(&src) else {
        return CopyCookieOutcome::NoCookieFoundForSrc(src);
    };

    let cookies: Vec<_> = header
        .to_str()
        .expect("cookie value must be string encodable")
        .split(' ')
        .map(HeaderValue::try_from)
        .filter_map(|x| x.ok())
        .collect();
    jar.set_cookies(&mut cookies.iter(), dest);
    CopyCookieOutcome::SetCookies(cookies)
}
