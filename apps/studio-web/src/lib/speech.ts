let cachedVoice: SpeechSynthesisVoice | null = null;

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance !== 'undefined';
}

function pickRussianVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice) {
    return cachedVoice;
  }
  if (!isSpeechSupported()) {
    return null;
  }
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) {
    return null;
  }
  const russian = voices.filter((voice) => voice.lang.toLowerCase().startsWith('ru'));
  const preferred =
    russian.find((voice) => /milena|yuri|google|microsoft|alena|katya/i.test(voice.name)) ??
    russian.find((voice) => voice.default) ??
    russian[0];
  cachedVoice = preferred ?? null;
  return cachedVoice;
}

export function primeSpeechVoices(): void {
  if (!isSpeechSupported()) {
    return;
  }
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoice = null;
    pickRussianVoice();
  };
}

export interface SpeakOptions {
  rate?: number;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

/**
 * Reads text aloud in Russian through the browser Web Speech API.
 * Returns false when the platform has no speech synthesis (for example headless preview).
 */
export function speakRussian(text: string, options: SpeakOptions = {}): boolean {
  if (!isSpeechSupported()) {
    options.onError?.('Этот браузер не поддерживает озвучку. Откройте инструкцию в Chrome или Edge.');
    return false;
  }

  const synth = window.speechSynthesis;
  synth.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ru-RU';
  utterance.rate = options.rate ?? 0.95;
  utterance.pitch = 1;
  const voice = pickRussianVoice();
  if (voice) {
    utterance.voice = voice;
  }
  if (options.onEnd) {
    utterance.onend = () => options.onEnd?.();
  }
  utterance.onerror = () => {
    options.onError?.('Не удалось озвучить шаг: проверьте, что в системе установлен русский голос.');
  };

  synth.speak(utterance);
  return true;
}

export function stopSpeech(): void {
  if (isSpeechSupported()) {
    window.speechSynthesis.cancel();
  }
}
