//! Initializes Android's system certificate verifier before Tauri starts networking.

use jni::{JNIEnv, objects::JObject, sys::jboolean};

#[unsafe(no_mangle)]
extern "system" fn Java_com_macro_app_prod_MainActivity_initializeCertificateVerifier(
    mut env: JNIEnv,
    _activity: JObject,
    context: JObject,
) -> jboolean {
    // MainActivity passes the application context, whose lifetime is the process.
    // The verifier retains its own global JNI references and initializes once.
    match rustls_platform_verifier::android::init_with_env(&mut env, context) {
        Ok(()) => jni::sys::JNI_TRUE,
        Err(_) => jni::sys::JNI_FALSE,
    }
}
