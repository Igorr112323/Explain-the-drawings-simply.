import type { CapacitorConfig } from '@capacitor/cli';

/**
 * «ИК-Гайд Цех» — the worker tablet app.
 *
 * The web bundle is the same `apps/studio-web` build: Capacitor only adds the Android shell, the
 * camera permission for the QR scanner and a WebView that is allowed to talk to the workshop server
 * over plain HTTP on the local network (`network_security_config.xml` limits cleartext to LAN ranges).
 */
const config: CapacitorConfig = {
  appId: 'ru.ikguide.worker',
  appName: 'ИК-Гайд Цех',
  webDir: '../../apps/studio-web/dist',
  android: {
    // The shop-floor server speaks HTTP on 192.168.x.x; the WebView must not block it.
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    backgroundColor: '#f9f9fb',
  },
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
};

export default config;
