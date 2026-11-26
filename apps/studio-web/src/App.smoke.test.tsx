// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from './App';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root | null = null;

function renderApp() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<App />);
  });
  return container;
}

function clickByText(text: string) {
  const button = Array.from(container.querySelectorAll('button')).find((element) =>
    element.textContent?.trim().includes(text),
  );
  if (!button) {
    throw new Error(`Кнопка «${text}» не найдена`);
  }
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  return button as HTMLButtonElement;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
});

describe('studio smoke test', () => {
  it('renders the worker home screen with both demo projects', () => {
    const element = renderApp();
    const text = element.textContent ?? '';
    expect(text).toContain('Мои инструкции');
    expect(text).toContain('Кронштейн крепления сервопривода КС-04');
    expect(text).toContain('Корпус редуктора РД-12 (сборка)');
    expect(text).toContain('Сфоткать');
    expect(text).toContain('Проверка размеров');
    expect(element.querySelectorAll('.pin').length).toBe(0);
  });

  it('prepares the printable A4 guide: cover + one page per step + qc page', () => {
    renderApp();
    const pages = document.querySelectorAll('.print-page');
    expect(pages.length).toBe(8);
    expect(pages[0]?.textContent).toContain('Комплектация и крепёж');
    expect(pages[pages.length - 1]?.textContent).toContain('Проверь перед сдачей');
  });

  it('shows one interactive pin per drawing annotation on the x-ray sheet', () => {
    renderApp();
    clickByText('Рентген чертежа');
    expect(container.querySelectorAll('.pin').length).toBe(6);
    clickByText('Ø20');
    expect(container.textContent).toContain('20,000…20,021');
  });

  it('opens the anti-hallucination screen and confirms an uncertain dimension', () => {
    renderApp();
    clickByText('Проверка размеров');
    expect(container.textContent).toContain('Быстрая проверка');
    expect(container.textContent).toContain('Плохо видно');

    clickByText('18 мм');
    expect(container.textContent).toContain('Подтверждено человеком: 18 мм');
  });

  it('walks through the step screen with the big navigation buttons', () => {
    renderApp();
    clickByText('Шаги инструкции');
    expect(container.textContent).toContain('Шаг 1 из 6');
    expect(container.textContent).toContain('Анти-ошибка');

    clickByText('Дальше');
    expect(container.textContent).toContain('Шаг 2 из 6');

    clickByText('Назад');
    expect(container.textContent).toContain('Шаг 1 из 6');
  });

  it('translates a notation typed by hand on the x-ray screen', () => {
    renderApp();
    clickByText('Рентген чертежа');
    expect(container.textContent).toContain('Проверить любой шифр ГОСТ');

    const input = container.querySelector<HTMLInputElement>('.manual-row input');
    expect(input).not.toBeNull();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'Ø32 H7/k6');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const text = container.textContent ?? '';
    expect(text).toContain('Допуск / посадка');
    expect(text).toContain('переходная посадка');
    expect(text).toContain('32…32,025');
  });

  it('switches to the engineer canvas and back to the worker preview', () => {
    renderApp();
    clickByText('Инженер');
    expect(container.textContent).toContain('Свободный холст');
    expect(container.textContent).toContain('Комплектация и крепёж');
    expect(container.querySelectorAll('.step-canvas-card').length).toBe(6);

    clickByText('Глазами рабочего');
    expect(container.textContent).toContain('Перед началом работы');
  });

  it('completes the qc checklist and reaches the done screen', () => {
    renderApp();
    clickByText('Проверка размеров');
    clickByText('18 мм');
    clickByText('Да, всё верно');
    clickByText('Да, всё верно');
    expect(container.textContent).toContain('Все размеры подтверждены');

    const back = container.querySelector<HTMLButtonElement>('button[aria-label="Назад"]');
    expect(back).not.toBeNull();
    act(() => {
      back?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    clickByText('Чек-лист ОТК');
    expect(container.textContent).toContain('Проверьте перед сдачей');

    const checkboxes = Array.from(container.querySelectorAll<HTMLInputElement>('.qc-row input'));
    expect(checkboxes.length).toBe(5);
    act(() => {
      checkboxes.forEach((checkbox) => {
        checkbox.click();
      });
    });

    clickByText('Завершить инструкцию');
    expect(container.textContent).toContain('Инструкция выполнена');
  });
});
