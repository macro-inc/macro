import assert from 'node:assert/strict';

export function screenPointForInput(
  hierarchy,
  packageName,
  { rect, viewport }
) {
  // UIAutomator lists the native container before Chromium's nested virtual
  // WebView node. Use the container's screen bounds, not page content bounds.
  const webView = (hierarchy.match(/<node\b[^>]*>/g) ?? []).find(
    (node) =>
      node.includes('class="android.webkit.WebView"') &&
      node.includes(`package="${packageName}"`)
  );
  assert.ok(webView, 'Macro WebView is unavailable');
  const bounds = webView.match(
    /bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/
  );
  assert.ok(bounds, 'WebView screen bounds are unavailable');
  const [left, top, right, bottom] = bounds.slice(1).map(Number);
  assert.ok(right > left && bottom > top);
  assert.ok(viewport.width > 0 && viewport.height > 0);
  const cssX = rect.left + rect.width / 2 - viewport.left;
  const cssY = rect.top + rect.height / 2 - viewport.top;
  assert.ok(
    cssX > 0 && cssX < viewport.width,
    'Input center is outside the viewport'
  );
  assert.ok(
    cssY > 0 && cssY < viewport.height,
    'Input center is outside the viewport'
  );
  return {
    x: Math.round(left + (cssX * (right - left)) / viewport.width),
    y: Math.round(top + (cssY * (bottom - top)) / viewport.height),
  };
}

export function testShareTokens(files, { imageName, sharedText }) {
  return files
    .filter(
      (file) =>
        /^share-stage-[a-f0-9]{32}$/.test(file.token) &&
        (file.isSharedText
          ? file.sharedText === sharedText
          : file.name === imageName)
    )
    .map((file) => file.token);
}
