package app.web.momentum;

import android.os.Bundle;
import android.webkit.JavascriptInterface;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
	@Override
	public void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);

		WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

		getBridge().getWebView().addJavascriptInterface(new SystemUiBridge(), "MomentumSystemUi");
		applySystemBarAppearance(isSystemDarkMode());
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
		public void setDarkMode(final boolean dark) {
			runOnUiThread(() -> applySystemBarAppearance(dark));
		}
	}
}
