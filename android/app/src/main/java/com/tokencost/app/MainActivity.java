package com.tokencost.app;

import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {
    private WebView webView;
    private LinearLayout connectLayout;
    private EditText ipInput;
    private TextView statusText;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        prefs = getSharedPreferences("TokenCost", MODE_PRIVATE);
        webView = findViewById(R.id.webView);
        connectLayout = findViewById(R.id.connectLayout);
        ipInput = findViewById(R.id.ipInput);
        statusText = findViewById(R.id.statusText);

        String savedIp = prefs.getString("server_ip", "");
        if (!savedIp.isEmpty()) {
            ipInput.setText(savedIp);
            connectToServer(savedIp);
        }

        findViewById(R.id.connectBtn).setOnClickListener(v -> {
            String ip = ipInput.getText().toString().trim();
            if (ip.isEmpty()) {
                Toast.makeText(this, "请输入服务器地址", Toast.LENGTH_SHORT).show();
                return;
            }
            prefs.edit().putString("server_ip", ip).apply();
            connectToServer(ip);
        });

        // 可预测式返回: 使用 OnBackPressedDispatcher 替代 onBackPressed()
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView != null && webView.getVisibility() == View.VISIBLE && webView.canGoBack()) {
                    // WebView 可后退 → 走 WebView 历史
                    webView.goBack();
                } else if (webView != null && webView.getVisibility() == View.VISIBLE) {
                    // WebView 到底了 → 断开连接弹窗
                    new AlertDialog.Builder(MainActivity.this)
                        .setMessage("断开连接并返回设置页面？")
                        .setPositiveButton("断开", (d, w) -> {
                            webView.setVisibility(View.GONE);
                            connectLayout.setVisibility(View.VISIBLE);
                            statusText.setText("");
                        })
                        .setNegativeButton("取消", null)
                        .show();
                } else {
                    // 设置页面 → 直接退出
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });
    }

    private void connectToServer(String ip) {
        if (!ip.startsWith("http")) {
            ip = "http://" + ip;
        }
        if (!ip.contains(":")) {
            ip = ip + ":3456";
        }
        final String url = ip;

        statusText.setText("正在连接 " + url + "...");
        connectLayout.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);

        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setMixedContentMode(0);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                webView.setVisibility(View.GONE);
                connectLayout.setVisibility(View.VISIBLE);
                statusText.setText("连接失败: " + description);
            }
        });
        webView.setWebChromeClient(new WebChromeClient());

        webView.loadUrl(url);
    }
}
