package com.macro.app;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.util.WebColor;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        View webView = this.getBridge().getWebView();
        Activity activity = this.getBridge().getActivity();
        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, windowInsets) -> {
            activity.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Window window = activity.getWindow();
                    WindowInsetsControllerCompat windowInsetsControllerCompat = WindowCompat.getInsetsController(window, window.getDecorView());
                    if (windowInsetsControllerCompat.isAppearanceLightStatusBars()) {
                        view.getRootView().setBackgroundColor(WebColor.parseColor("#FFFFFF"));
                    } else {
                        view.getRootView().setBackgroundColor(WebColor.parseColor("#222222"));
                    }
                }
            });

            Insets insets = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            ViewGroup.MarginLayoutParams mlp = (ViewGroup.MarginLayoutParams) view.getLayoutParams();
            mlp.leftMargin = insets.left;
            mlp.bottomMargin = insets.bottom;
            mlp.rightMargin = insets.right;
            mlp.topMargin = insets.top;
            view.setLayoutParams(mlp);

            return WindowInsetsCompat.CONSUMED;
        });
    }
}
