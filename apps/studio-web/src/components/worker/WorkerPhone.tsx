import { useStudio, type WorkerScreen } from '../../state/studio';
import { HomeScreen } from './HomeScreen';
import { VerifyScreen } from './VerifyScreen';
import { PrepScreen } from './PrepScreen';
import { StepsScreen } from './StepsScreen';
import { XrayScreen } from './XrayScreen';
import { QcScreen } from './QcScreen';
import { DoneScreen } from './DoneScreen';

const SCREEN_COMPONENTS: Readonly<Record<WorkerScreen, () => JSX.Element>> = {
  home: HomeScreen,
  verify: VerifyScreen,
  prep: PrepScreen,
  steps: StepsScreen,
  xray: XrayScreen,
  qc: QcScreen,
  done: DoneScreen,
};

export function WorkerPhone() {
  const { state, doc } = useStudio();
  const Screen = SCREEN_COMPONENTS[state.screen] ?? HomeScreen;

  return (
    <div className="worker-stage">
      <div className="phone" role="region" aria-label="Прототип цехового приложения">
        <div className="phone-notch" aria-hidden="true" />
        <div className="phone-status">
          <span>9:41</span>
          <span className="phone-status-center">{doc.metadata.drawingCode}</span>
          <span className="phone-status-icons" aria-hidden="true">
            ▮▮▮
          </span>
        </div>
        <div className="phone-screen">
          <Screen />
        </div>
        <div className="phone-home" aria-hidden="true" />
      </div>

      <aside className="worker-caption">
        <div className="caption-block">
          <strong>Рабочий · прототип .apk</strong>
          <p>
            Экран цеха: крупные кнопки под перчатку, шаги от 18 px, озвучка на русском и свайпы. Позже этот же
            интерфейс упакуется в Android через Capacitor.
          </p>
        </div>
        <ul className="caption-list">
          <li>
            <span className="dot dot-accent" /> Синий — деталь, с которой работаем сейчас
          </li>
          <li>
            <span className="dot dot-danger" /> Красный — анти-ошибка и критический допуск
          </li>
          <li>
            <span className="dot dot-success" /> Зелёный — выполнено и проверено
          </li>
        </ul>
        <button type="button" className="link-button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          ↕ Прокрутите телефон, чтобы увидеть все экраны
        </button>
      </aside>
    </div>
  );
}
