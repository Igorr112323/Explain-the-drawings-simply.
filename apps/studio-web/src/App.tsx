import { StudioProvider, useStudio } from './state/studio';
import { TopBar } from './components/TopBar';
import { WorkerPhone } from './components/worker/WorkerPhone';
import { EngineerCanvas } from './components/engineer/EngineerCanvas';
import { PrintSheet } from './components/engineer/PrintSheet';
import { ToastHost } from './components/ToastHost';
import { ScanDialog } from './components/common/ScanDialog';

function StudioShell() {
  const { state, dispatch } = useStudio();

  return (
    <>
      <div className="app-shell">
        <TopBar />
        <main className="stage">{state.mode === 'worker' ? <WorkerPhone /> : <EngineerCanvas />}</main>
        <ToastHost />
        {state.scan.open ? (
          <ScanDialog mode={state.scan.mode} files={state.scan.files} onClose={() => dispatch({ type: 'CLOSE_SCAN' })} />
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
