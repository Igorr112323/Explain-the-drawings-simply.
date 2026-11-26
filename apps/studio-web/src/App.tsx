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
import { listGuides } from './lib/offlineStore';
import { readGuideIdFromLocation, readPayloadFromLocation } from './lib/runtimeConfig';

/**
 * Nobody types an address in a workshop: a QR code opens `…/?g=<payload>` and the studio must show
 * the instruction *immediately*, already stored offline. `?guide=<id>` links resolve against the
 * offline library instead.
 */
function useBootLink() {
  const { adoptGuide, dispatch } = useStudio();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    const guideId = readGuideIdFromLocation();
    if (guideId) {
      void (async () => {
        const stored = (await listGuides()).find((entry) => entry.id === guideId);
        if (stored) {
          await adoptGuide(stored.doc, 'qr');
          dispatch({ type: 'SHOW_TOAST', tone: 'success', text: `Инструкция «${stored.doc.metadata.title}» открыта по цеховой ссылке.` });
          return;
        }
        dispatch({
          type: 'SHOW_TOAST',
          tone: 'danger',
          text: 'Этой инструкции нет на устройстве: откройте ссылку при работающем цеховом сервере.',
        });
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
