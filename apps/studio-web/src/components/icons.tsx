/**
 * Тонкоконтурные иконки холста: `stroke="currentColor"`, ширина 1.6, никаких заливок.
 *
 * Рисуются вручную, без библиотеки: набор маленький, зато вес нулевой, а линия ровно та же, что в
 * референсе — монохромный контур, который красится цветом кнопки (серый в покое, синий при
 * действии).
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 22, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** «Назад» — к чистому холсту. */
export function IconBack(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </Icon>
  );
}

/** Отменить последнюю правку: стрелка, заворачивающая назад. */
export function IconUndo(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8.5 8.5H14a5 5 0 0 1 0 10h-3" />
      <path d="M11 5.5 8 8.5l3 3" />
    </Icon>
  );
}

/** Главное действие: поделиться/сохранить готовый PDF. */
export function IconExport(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 15.5V4.5" />
      <path d="M8.5 8 12 4.5 15.5 8" />
      <path d="M5.5 13.5v4.6a1.4 1.4 0 0 0 1.4 1.4h10.2a1.4 1.4 0 0 0 1.4-1.4v-4.6" />
    </Icon>
  );
}

/** «Ещё» — компактное меню в стиле Apple popover. */
export function IconMore(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="6.2" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="17.8" cy="12" r="1.15" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** Стопка листов: примеры чертежей. */
export function IconStack(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="8.5" y="3.8" width="11" height="14" rx="2.2" />
      <path d="M6 6.6H5.4A1.4 1.4 0 0 0 4 8v10.6a1.4 1.4 0 0 0 1.4 1.4H13" />
      <path d="M11.4 8.6h5.2M11.4 12.2h5.2" />
    </Icon>
  );
}

/** «Править текст»: буква A в круге. */
export function IconText(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M9.4 15.4 12 8.6l2.6 6.8" />
      <path d="M10.3 13.2h3.4" />
    </Icon>
  );
}

/** «Рентген ГОСТ»: буква A в скобках. */
export function IconXray(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7.4 4.6H4.8v14.8h2.6" />
      <path d="M16.6 4.6h2.6v14.8h-2.6" />
      <path d="M10.4 15.2 12 9.2l1.6 6" />
      <path d="M11 13.2h2" />
    </Icon>
  );
}

/** Скрепка: загрузить файл. */
export function IconAttach(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M16.9 11.2 11 17.1a3.6 3.6 0 0 1-5.1-5.1l6.6-6.6a2.4 2.4 0 0 1 3.4 3.4l-6.6 6.6a1.2 1.2 0 0 1-1.7-1.7l5.9-5.9" />
    </Icon>
  );
}

/** Пометка «Осторожно!»: квадрат с карандашом. */
export function IconCompose(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12.4 4.6H6.2A1.6 1.6 0 0 0 4.6 6.2v11.6a1.6 1.6 0 0 0 1.6 1.6h11.6a1.6 1.6 0 0 0 1.6-1.6v-6.2" />
      <path d="M16.2 4.4a1.9 1.9 0 0 1 2.7 2.7l-6.3 6.3-3.2.6.6-3.2z" />
    </Icon>
  );
}

/** Крестик: закрыть поповер. */
export function IconClose(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </Icon>
  );
}

/** Стрелка вниз: раскрыть строку шага. */
export function IconChevron(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.5 9.5 12 15l5.5-5.5" />
    </Icon>
  );
}

/** Солнце: светлая тема цеха. */
export function IconSun(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3.4v1.8M12 18.8v1.8M3.4 12h1.8M18.8 12h1.8M6 6l1.3 1.3M16.7 16.7 18 18M18 6l-1.3 1.3M7.3 16.7 6 18" />
    </Icon>
  );
}

/** Луна: тёмная тема цеха. */
export function IconMoon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19 14.4A7.6 7.6 0 0 1 9.6 5a7.6 7.6 0 1 0 9.4 9.4z" />
    </Icon>
  );
}
