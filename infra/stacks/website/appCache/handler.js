// The response policy supplies no-store even when CloudFront skips this function
// for origin errors. Only successful, content-hashed files get a long lifetime.
// biome-ignore lint/correctness/noUnusedVariables: CloudFront invokes this entry point.
function handler(event) {
  const response = event.response;
  const hashedAsset =
    /-(?=[A-Za-z0-9_-]*[A-Z0-9_])[A-Za-z0-9_-]{8}\.(?:js|css|wasm|woff2?|ttf|svg|png|jpe?g|webp|glb)(?:\.map)?$/;
  if (
    (response.statusCode === 200 || response.statusCode === 304) &&
    hashedAsset.test(event.request.uri)
  ) {
    response.headers['cache-control'] = {
      value: 'public, max-age=31536000, immutable',
    };
  }
  return response;
}
