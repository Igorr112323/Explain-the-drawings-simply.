import { StudioProvider, useStudio } from './state/studio';
import { TopBar } from './components/TopBar';
import { WorkerPhone } from './components/worker/WorkerPhone';
import { EngineerCanvas } from './components/engineer/EngineerCanvas';
import { PrintSheet } from './components/engineer/PrintSheet';
import { ToastHost } from './components/ToastHost';

function StudioShell() {
  const { state } = useStudio();

  return (
    <>
      <div className="app-shell">
        <TopBar />
        <main className="stage">{state.mode === 'worker' ? <WorkerPhone /> : <EngineerCanvas />}</main>
        <ToastHost />
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
