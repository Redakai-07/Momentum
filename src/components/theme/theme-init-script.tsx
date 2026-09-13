import Script from "next/script";

/**
 * Applies the persisted theme before first paint to avoid a flash.
 * `beforeInteractive` traditionally lives in pages/_document; in the App
 * Router the root layout is the equivalent top-level document context.
 */
export function ThemeInitScript() {
  return (
    /* eslint-disable @next/next/no-before-interactive-script-outside-document */
    <Script
      id="theme-init"
      strategy="beforeInteractive"
      dangerouslySetInnerHTML={{
        __html: `(function(){try{var t=localStorage.getItem("momentum:theme");var dark=t==="dark"||((!t||t==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",dark);var a=localStorage.getItem("momentum:accent-color");if(a)document.documentElement.dataset.accent=a;var n=window.MomentumSystemUi;if(n){var i=JSON.parse(n.getSafeAreaInsets());document.documentElement.style.setProperty("--momentum-safe-area-inset-top",i.top+"px");document.documentElement.style.setProperty("--momentum-safe-area-inset-bottom",i.bottom+"px");}}catch(e){}})();`,
      }}
    />
    /* eslint-enable @next/next/no-before-interactive-script-outside-document */
  );
}
