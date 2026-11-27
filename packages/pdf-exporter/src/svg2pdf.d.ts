/**
 * `svg2pdf.js` публикует ESM-сборку отдельным файлом, а `main` в package.json указывает на UMD,
 * которому нужен глобальный `jspdf`. Типы у пакета общие, поэтому импортируем ESM-файл, а типы берём
 * из самого пакета.
 */
declare module 'svg2pdf.js/dist/svg2pdf.es.min.js' {
  export { svg2pdf } from 'svg2pdf.js';
}
