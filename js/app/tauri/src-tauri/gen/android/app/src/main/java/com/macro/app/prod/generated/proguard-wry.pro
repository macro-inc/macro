# THIS FILE IS AUTO-GENERATED. DO NOT MODIFY!!

# Copyright 2020-2023 Tauri Programme within The Commons Conservancy
# SPDX-License-Identifier: Apache-2.0
# SPDX-License-Identifier: MIT

-keep class com.macro.app.prod.* {
  native <methods>;
}

-keep class com.macro.app.prod.WryActivity {
  public <init>(...);

  void setWebView(com.macro.app.prod.RustWebView);
  java.lang.Class getAppClass(...);
  java.lang.String getVersion();
}

-keep class com.macro.app.prod.Ipc {
  public <init>(...);

  @android.webkit.JavascriptInterface public <methods>;
}

-keep class com.macro.app.prod.RustWebView {
  public <init>(...);

  void loadUrlMainThread(...);
  void loadHTMLMainThread(...);
  void evalScript(...);
}

-keep class com.macro.app.prod.RustWebChromeClient,com.macro.app.prod.RustWebViewClient {
  public <init>(...);
}
