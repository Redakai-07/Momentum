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
        __html: `(function(){try{var t=localStorage.getItem("momentum:theme");var dark=t==="dark"||((!t||t==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",dark);}catch(e){}})();`,
      }}
    />
    /* eslint-enable @next/next/no-before-interactive-script-outside-document */
  );
}
