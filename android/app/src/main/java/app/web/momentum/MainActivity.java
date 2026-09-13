package app.web.momentum;

import android.os.Bundle;
import android.content.res.Configuration;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.core.graphics.Insets;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
	private volatile int safeTop;
	private volatile int safeBottom;

	@Override
	public void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);

		WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
		WebView webView = getBridge().getWebView();
		webView.setBackgroundColor(android.graphics.Color.TRANSPARENT);
		ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (view, insets) -> {
			Insets systemBars = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars()
					| androidx.core.view.WindowInsetsCompat.Type.displayCutout());
			Insets gestures = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.mandatorySystemGestures());
			safeTop = systemBars.top;
			safeBottom = Math.max(systemBars.bottom, gestures.bottom);
			updateWebViewInsets(webView);
			return insets;
		});
		ViewCompat.requestApplyInsets(getWindow().getDecorView());

		webView.addJavascriptInterface(new SystemUiBridge(), "MomentumSystemUi");
		applySystemBarAppearance(isSystemDarkMode());
	}

	@Override
	public void onConfigurationChanged(Configuration newConfig) {
		super.onConfigurationChanged(newConfig);
		applySystemBarAppearance(isSystemDarkMode());
		getBridge().getWebView().evaluateJavascript(
				"window.dispatchEvent(new Event('momentum-system-theme-change'))",
				null);
	}

	private void updateWebViewInsets(WebView webView) {
		webView.evaluateJavascript(
				"(function(){var s=document.documentElement.style;"
						+ "s.setProperty('--momentum-safe-area-inset-top','" + safeTop + "px');"
						+ "s.setProperty('--momentum-safe-area-inset-bottom','" + safeBottom + "px');})();",
				null);
	}

	private boolean isSystemDarkMode() {
		return (getResources().getConfiguration().uiMode
				& android.content.res.Configuration.UI_MODE_NIGHT_MASK)
				== android.content.res.Configuration.UI_MODE_NIGHT_YES;
	}

	private void applySystemBarAppearance(boolean dark) {
		WindowInsetsControllerCompat controller =
				WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
		controller.setAppearanceLightStatusBars(!dark);
		controller.setAppearanceLightNavigationBars(!dark);
	}

	private final class SystemUiBridge {
		@JavascriptInterface
		public String getSafeAreaInsets() {
			return "{\"top\":" + safeTop + ",\"bottom\":" + safeBottom + "}";
		}

		@JavascriptInterface
		public void setDarkMode(final boolean dark) {
			runOnUiThread(() -> applySystemBarAppearance(dark));
		}
	}
}
