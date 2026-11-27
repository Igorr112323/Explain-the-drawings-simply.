import { describe, expect, it } from 'vitest';
import {
  backendHint,
  detectRuntime,
  getVisionBaseUrl,
  joinUrl,
  NATIVE_VISION_URL,
  sanitizeBaseUrl,
} from './runtimeConfig';

describe('адреса локальных сервисов', () => {
  it('в браузере запросы идут относительными путями (их проксирует Vite)', () => {
    expect(detectRuntime({ window: {} })).toBe('web');
    expect(getVisionBaseUrl('web')).toBe('');
    expect(joinUrl(getVisionBaseUrl('web'), '/v1/recognize')).toBe('/v1/recognize');
  });

  it('в упакованном .exe — локальный движок на 127.0.0.1:8000', () => {
    expect(detectRuntime({ window: { __TAURI_INTERNALS__: {} } })).toBe('tauri-desktop');
    expect(getVisionBaseUrl('tauri-desktop')).toBe(NATIVE_VISION_URL);
    expect(joinUrl(NATIVE_VISION_URL, '/v1/recognize')).toBe('http://127.0.0.1:8000/v1/recognize');
  });

  it('принимает только абсолютный http(s) адрес без хвостового слэша', () => {
    expect(sanitizeBaseUrl(' http://192.168.1.50:8000/ ')).toBe('http://192.168.1.50:8000');
    expect(sanitizeBaseUrl('https://example.com/api///')).toBe('https://example.com/api');
    expect(sanitizeBaseUrl('127.0.0.1:8000')).toBe('');
    expect(sanitizeBaseUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeBaseUrl('')).toBe('');
    expect(sanitizeBaseUrl(null)).toBe('');
  });

  it('не склеивает двойные слэши', () => {
    expect(joinUrl('http://127.0.0.1:8000/', 'v1/recognize')).toBe('http://127.0.0.1:8000/v1/recognize');
  });

  it('подсказка говорит, что именно запустить', () => {
    expect(backendHint()).toContain('npm run dev:vision');
  });
});
