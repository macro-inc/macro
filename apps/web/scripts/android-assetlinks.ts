const fingerprints = process.argv.slice(2).map((value) => value.toUpperCase());
if (
  fingerprints.length === 0 ||
  fingerprints.some((value) => !/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(value))
) {
  throw new Error('Pass one or more SHA-256 signing fingerprints (32 colon-separated bytes)');
}

console.log(JSON.stringify([{
  relation: ['delegate_permission/common.handle_all_urls'],
  target: {
    namespace: 'android_app',
    package_name: 'com.macro.app.prod',
    sha256_cert_fingerprints: [...new Set(fingerprints)],
  },
}], null, 2));
