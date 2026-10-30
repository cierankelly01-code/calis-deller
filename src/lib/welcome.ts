// Has this iPad seen the "how the app works" tour? A device setting, not
// display data, so it is not a "cd-" key and survives sign-out (see
// clearDisplayCache). If storage is blocked or full the tour must never
// trap anyone: a read failure counts as seen, and once finished in this
// page session it stays finished even if the write didn't stick.
const KEY = "kd-welcome-seen";
let seenThisSession = false;

export function welcomeSeen(): boolean {
  if (seenThisSession) return true;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return true;
  }
}

export function markWelcomeSeen(): void {
  seenThisSession = true;
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    // Storage full or blocked: the session flag above stops the loop.
  }
}
