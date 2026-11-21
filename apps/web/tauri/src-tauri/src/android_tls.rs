//! Initializes Android's system certificate verifier before Tauri starts networking.

use jni::{EnvUnowned, errors::ThrowRuntimeExAndDefault, objects::JObject, sys::jboolean};

#[unsafe(no_mangle)]
extern "system" fn Java_com_macro_workspace_mobile_MainActivity_initializeCertificateVerifier<
    'caller,
>(
    mut env: EnvUnowned<'caller>,
    _activity: JObject<'caller>,
    context: JObject<'caller>,
) -> jboolean {
    // MainActivity passes the application context, whose lifetime is the process.
    // The verifier retains its own global JNI references and initializes once.
    // No Rust logger exists yet, so a failure throws a RuntimeException carrying
    // the error into MainActivity's crash instead of returning false.
    env.with_env(|env| -> jni::errors::Result<jboolean> {
        rustls_platform_verifier::android::init_with_env(env, context)?;
        Ok(true)
    })
    .resolve::<ThrowRuntimeExAndDefault>()
}
