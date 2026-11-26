import { useEffect, useRef } from 'react';
import { StudioProvider, useStudio } from './state/studio';
import { TopBar } from './components/TopBar';
import { WorkerPhone } from './components/worker/WorkerPhone';
import { EngineerCanvas } from './components/engineer/EngineerCanvas';
import { PrintSheet } from './components/engineer/PrintSheet';
import { ToastHost } from './components/ToastHost';
import { ScanDialog } from './components/common/ScanDialog';
import { SettingsDialog } from './components/common/SettingsDialog';
import { QrScannerDialog } from './components/common/QrScannerDialog';
import { decodeGuidePayload } from './lib/qrBridge';
import { getGuideByCode } from './lib/offlineStore';
import { fetchPublishedGuide, readPublishedLink } from './lib/publishedGuides';
import { loadSettings, readPayloadFromLocation, saveSettings } from './lib/runtimeConfig';

/**
 * Nobody types an address in a workshop: a QR code opens `…/?g=<payload>` and the studio must show
 * the instruction *immediately*, already stored offline.
 *
 * `…/?guideId=<code>&api=http://192.168.1.50:8000` is the published-guide link: the instruction lives
 * on the workshop server, so it is downloaded once, remembered in the offline library and only then
 * shown. The `api` parameter is stored as the vision address for this device, so every later call of
 * the same phone goes to the same workshop laptop.
 */
function useBootLink() {
  const { adoptGuide, dispatch } = useStudio();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    const published = readPublishedLink();
    if (published) {
      void (async () => {
        if (published.api) {
          // The link knows its server: remember it, otherwise a phone that opened the studio from a
          // dev server would keep asking the wrong machine.
          const settings = loadSettings();
          if (settings.visionBaseUrl !== published.api) {
            saveSettings({ ...settings, visionBaseUrl: published.api });
            dispatch({ type: 'SET_SETTINGS', settings: { ...settings, visionBaseUrl: published.api } });
          }
        }
        try {
          const doc = await fetchPublishedGuide(published.guideId, { baseUrl: published.api ?? undefined });
          await adoptGuide(doc, 'published', 'prep', { publishedCode: published.guideId });
          dispatch({
            type: 'SHOW_TOAST',
            tone: 'success',
            text: `Инструкция «${doc.metadata.title}» скачана с цехового сервера и доступна офлайн.`,
          });
          return;
        } catch (error) {
          // No server right now — the copy saved on an earlier visit still opens the guide.
          const stored = await getGuideByCode(published.guideId);
          if (stored) {
            await adoptGuide(stored.doc, 'published');
            dispatch({
              type: 'SHOW_TOAST',
              tone: 'info',
              text: `Цеховой сервер недоступен: открыта сохранённая копия «${stored.doc.metadata.title}».`,
            });
            return;
          }
          dispatch({
            type: 'SHOW_TOAST',
            tone: 'danger',
            text: error instanceof Error ? error.message : 'Не удалось получить инструкцию с цехового сервера.',
          });
        }
      })();
      return;
    }

    const payload = readPayloadFromLocation();
    if (!payload) {
      return;
    }
    void (async () => {
      try {
        const doc = decodeGuidePayload(payload);
        await adoptGuide(doc, 'qr');
        dispatch({
          type: 'SHOW_TOAST',
          tone: 'success',
          text: `Инструкция «${doc.metadata.title}» открыта по QR-коду.`,
        });
      } catch (error) {
        dispatch({
          type: 'SHOW_TOAST',
          tone: 'danger',
          text: error instanceof Error ? error.message : 'QR-код не распознан.',
        });
      }
    })();
  }, [adoptGuide, dispatch]);
}

function StudioShell() {
  const { state, dispatch } = useStudio();
  useBootLink();

  return (
    <>
      <div className="app-shell">
        <TopBar />
        <main className="stage">{state.mode === 'worker' ? <WorkerPhone /> : <EngineerCanvas />}</main>
        <ToastHost />
        {state.scan.open ? (
          <ScanDialog mode={state.scan.mode} files={state.scan.files} onClose={() => dispatch({ type: 'CLOSE_SCAN' })} />
        ) : null}
        {state.settingsOpen ? (
          <SettingsDialog onClose={() => dispatch({ type: 'SET_SETTINGS_OPEN', open: false })} />
        ) : null}
        {state.scannerOpen ? (
          <QrScannerDialog onClose={() => dispatch({ type: 'SET_SCANNER_OPEN', open: false })} />
        ) : null}
      </div>
      <PrintSheet />
    </>
  );
}

export function App() {
  return (
    <StudioProvider>
      <StudioShell />
    </StudioProvider>
  );
}
