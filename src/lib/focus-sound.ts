let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextConstructor = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextConstructor) return null;
  audioContext ??= new AudioContextConstructor();
  return audioContext;
}

function playTone(frequency: number, delay: number, duration: number): void {
  const context = getAudioContext();
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const start = context.currentTime + delay;
  oscillator.frequency.value = frequency;
  oscillator.type = "sine";
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

/** Unlock audio from the user's Start tap so later phase changes can be heard. */
export function primeFocusSound(): void {
  const context = getAudioContext();
  if (!context) return;
  void context.resume();
}

/** Play a short, unobtrusive cue when focus changes into or out of a break. */
export function playFocusTransitionSound(nextPhase: "focus" | "short_break" | "long_break"): void {
  const context = getAudioContext();
  if (!context) return;
  void context.resume();
  if (nextPhase === "short_break") {
    playTone(660, 0, 0.16);
    playTone(880, 0.2, 0.2);
  } else if (nextPhase === "focus") {
    playTone(880, 0, 0.16);
    playTone(660, 0.2, 0.2);
  } else {
    playTone(523, 0, 0.16);
    playTone(659, 0.2, 0.16);
    playTone(784, 0.4, 0.24);
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
