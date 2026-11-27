/**
 * jsdom-заглушки для SVG-геометрии.
 *
 * Браузер (и WebView2 внутри `.exe`) умеет `getBBox`/`getScreenCTM`/`getComputedTextLength`, а jsdom —
 * нет. Без них `svg2pdf` падает на схемах с подписями по центру, и тест проверял бы не настоящую
 * отрисовку, а серую заглушку «Схема не поместилась».
 *
 * Значения приблизительные: тесты проверяют наличие векторных команд, шрифт и текст, а не
 * пиксельные координаты. Продукт эти заглушки не использует — файл `setupFiles` подключается только
 * в Vitest.
 */
type Box = { x: number; y: number; width: number; height: number };

function fontSizeOf(element: Element): number {
  const raw = element.getAttribute('font-size');
  const parsed = raw ? Number.parseFloat(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 12;
}

function textBox(element: Element): Box {
  const size = fontSizeOf(element);
  const text = (element.textContent ?? '').trim();
  return { x: 0, y: -size * 0.8, width: Math.max(1, text.length * size * 0.55), height: size * 1.2 };
}

export function installJsdomSvgGeometry(): void {
  if (typeof window === 'undefined' || typeof window.SVGElement === 'undefined') {
    return;
  }
  const prototype = window.SVGElement.prototype as unknown as Record<string, unknown>;
  const elementPrototype = window.Element.prototype as unknown as Record<string, unknown>;

  if (typeof prototype.getBBox !== 'function') {
    prototype.getBBox = function getBBox(this: Element): Box {
      return this.tagName.toLowerCase() === 'text' ? textBox(this) : { x: 0, y: 0, width: 10, height: 10 };
    };
  }
  if (typeof elementPrototype.getBBox !== 'function') {
    elementPrototype.getBBox = prototype.getBBox as (this: Element) => Box;
  }
  if (typeof prototype.getScreenCTM !== 'function') {
    prototype.getScreenCTM = function getScreenCTM() {
      return {
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        e: 0,
        f: 0,
        inverse() {
          return this;
        },
        multiply() {
          return this;
        },
        scale() {
          return this;
        },
        translate() {
          return this;
        },
      };
    };
  }
  if (typeof prototype.getComputedTextLength !== 'function') {
    prototype.getComputedTextLength = function getComputedTextLength(this: Element): number {
      return textBox(this).width;
    };
  }
}

/**
 * Прокрутка элемента: в браузере `scrollTo` есть у любого элемента, в jsdom — нет, и вызов из
 * `requestAnimationFrame` превращался в необработанное исключение уже после теста.
 */
export function installScrollStubs(): void {
  if (typeof window === 'undefined' || typeof window.Element === 'undefined') {
    return;
  }
  const prototype = window.Element.prototype as unknown as Record<string, unknown>;
  for (const method of ['scrollTo', 'scrollBy', 'scrollIntoView']) {
    if (typeof prototype[method] !== 'function') {
      prototype[method] = function noopScroll(this: Element): void {
        void this;
      };
    }
  }
}

installJsdomSvgGeometry();
installScrollStubs();
