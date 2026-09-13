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

import java.util.Locale;

public class MainActivity extends BridgeActivity {
	private volatile float safeTopDp;
	private volatile float safeBottomDp;

	@Override
	public void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);

		WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
		WebView webView = getBridge().getWebView();
		webView.setBackgroundColor(android.graphics.Color.TRANSPARENT);
		ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (view, insets) -> {
			Insets systemBars = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars()
					| androidx.core.view.WindowInsetsCompat.Type.displayCutout());
			float density = getResources().getDisplayMetrics().density;
			if (density <= 0f) {
				density = 1.0f;
			}
			safeTopDp = systemBars.top / density;
			safeBottomDp = systemBars.bottom / density;
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
				String.format(
						Locale.US,
						"(function(){var s=document.documentElement.style;"
								+ "s.setProperty('--momentum-safe-area-inset-top','%.2fpx');"
								+ "s.setProperty('--momentum-safe-area-inset-bottom','%.2fpx');})();",
						safeTopDp,
						safeBottomDp),
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
			return String.format(
					Locale.US,
					"{\"top\":%.2f,\"bottom\":%.2f}",
					safeTopDp,
					safeBottomDp);
		}

		@JavascriptInterface
		public void setDarkMode(final boolean dark) {
			runOnUiThread(() -> applySystemBarAppearance(dark));
		}
	}
}
