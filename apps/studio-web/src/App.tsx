import { usePipeline } from './state/pipeline';
import { TopBar } from './components/TopBar';
import { ErrorScreen, ProcessingScreen, UploadScreen } from './components/UploadScreen';
import { ReviewScreen } from './components/ReviewScreen';

/**
 * Однозадачный продукт: загрузил чертёж или 3D → скачал готовый PDF-инструкцию.
 *
 * Экранов ровно три состояния конвейера: загрузка, работа, предпросмотр с правками. Ничего
 * «цехового», никаких ролей, QR и настроек — если пользователю что-то нужно, это одна кнопка.
 */
export function App() {
  const api = usePipeline();

  return (
    <div className="app">
      <TopBar onHome={api.actions.reset} inReview={api.stage === 'review'} />

      <main className="app-main">
        {api.stage === 'upload' && (
          <UploadScreen onFiles={(list) => void api.actions.start(list)} onDemo={(id) => void api.actions.openExample(id)} />
        )}

        {api.stage === 'working' && (
          <ProcessingScreen label={api.progress} percent={api.percent} files={api.files} />
        )}

        {api.stage === 'error' && api.error && (
          <ErrorScreen
            message={api.error.message}
            hint={api.error.hint}
            onRetry={api.actions.reset}
            onDemo={(id) => void api.actions.openExample(id)}
          />
        )}

        {api.stage === 'review' && api.doc && <ReviewScreen api={api} />}
      </main>

      <footer className="app-footer">
        <span>IkGuide · локально на вашем компьютере</span>
        <span className="app-footer-sep" aria-hidden="true">
          ·
        </span>
        <span>чертёж → PDF · без облака</span>
      </footer>
    </div>
  );
}
