"use client";

// Timer alerts for the sandwich counter, for an iPad that lives on the
// counter with the app open. Two channels, both local to the device:
//   * a system notification via the service worker (works on a home-screen
//     PWA on iOS 16.4+ and any desktop browser once the user has allowed it)
//   * an audible chime from a Web Audio oscillator — no asset to load and
//     nothing for the CSP to allow.
// Both need one user gesture to switch on (browser rules), so the board has
// a "Turn on alerts" button. Nothing here is a substitute for the in-app
// countdown, which needs no permission at all.

const ENABLED_KEY = "cd-ambient-alerts";
const FIRED_KEY = "cd-ambient-alerts-fired";

let audio: AudioContext | null = null;
const CHANGED = "ambient-alerts-changed";

// For useSyncExternalStore: re-render whenever the setting flips.
export function subscribeAlerts(callback: () => void): () => void {
  window.addEventListener(CHANGED, callback);
  return () => window.removeEventListener(CHANGED, callback);
}

export function alertsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function alertsEnabled(): boolean {
  try {
    return window.localStorage.getItem(ENABLED_KEY) === "on" && (!alertsSupported() || Notification.permission === "granted");
  } catch {
    return false;
  }
}

// Must run inside a click handler: permission prompts and audio unlock are
// only allowed from a user gesture.
export async function enableAlerts(): Promise<boolean> {
  try {
    audio = audio ?? new AudioContext();
    if (audio.state === "suspended") await audio.resume();
  } catch {
    audio = null;
  }
  let granted = true;
  if (alertsSupported() && Notification.permission !== "granted") {
    granted = (await Notification.requestPermission()) === "granted";
  }
  try {
    window.localStorage.setItem(ENABLED_KEY, granted ? "on" : "off");
  } catch {
    // Best-effort.
  }
  window.dispatchEvent(new Event(CHANGED));
  if (granted) chime();
  return granted;
}

export function disableAlerts(): void {
  try {
    window.localStorage.setItem(ENABLED_KEY, "off");
  } catch {
    // Best-effort.
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function chime(): void {
  if (!audio) return;
  const now = audio.currentTime;
  // Three short rising notes — unmistakable over a busy shop.
  [0, 0.25, 0.5].forEach((offset, i) => {
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    osc.type = "sine";
    osc.frequency.value = 660 + i * 220;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.4, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.22);
    osc.connect(gain).connect(audio!.destination);
    osc.start(now + offset);
    osc.stop(now + offset + 0.25);
  });
}

export async function notify(title: string, body: string, tag: string): Promise<void> {
  if (!alertsSupported() || Notification.permission !== "granted") return;
  try {
    const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (registration) {
      await registration.showNotification(title, { body, tag, requireInteraction: true, data: { url: "/sandwiches" } });
    } else {
      new Notification(title, { body, tag });
    }
  } catch {
    // The chime and the in-app banner still carry the alert.
  }
}

export function readFired(): Set<string> {
  try {
    const raw = window.localStorage.getItem(FIRED_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((k): k is string => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}

export function markFired(keys: Set<string>): void {
  try {
    // Keep the list short: only the last few days' keys matter.
    window.localStorage.setItem(FIRED_KEY, JSON.stringify([...keys].slice(-200)));
  } catch {
    // Best-effort.
  }
}
