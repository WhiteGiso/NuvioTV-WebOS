import { Router } from "./router.js";
import { LocalStore } from "../../core/storage/localStore.js";

const ROTATED_DPAD_KEY = "rotatedDpadMapping";

function getArrowCodeFromKey(key) {
  if (key === "ArrowUp" || key === "Up") return 38;
  if (key === "ArrowDown" || key === "Down") return 40;
  if (key === "ArrowLeft" || key === "Left") return 37;
  if (key === "ArrowRight" || key === "Right") return 39;
  return null;
}

function isBackKey(event, normalizedCode) {
  const target = event?.target || null;
  const tagName = String(target?.tagName || "").toUpperCase();
  const isEditable = Boolean(
    target?.isContentEditable
    || tagName === "INPUT"
    || tagName === "TEXTAREA"
    || tagName === "SELECT"
  );
  const key = String(event?.key || "");
  const keyLower = key.toLowerCase();
  const code = String(event?.code || "");
  const rawCode = Number(event?.keyCode || 0);
  if (isEditable && (key === "Backspace" || rawCode === 8 || key === "Delete" || rawCode === 46)) {
    return false;
  }
  if (normalizedCode === 461 || rawCode === 461) {
    return true;
  }
  if (
    key === "Escape" ||
    key === "Esc" ||
    key === "Backspace" ||
    key === "GoBack" ||
    key === "XF86Back" ||
    code === "BrowserBack" ||
    code === "GoBack"
  ) {
    return true;
  }
  if (keyLower.includes("back")) {
    return true;
  }
  if (rawCode === 27 || rawCode === 8 || rawCode === 10009) {
    return true;
  }
  return false;
}

function isSimulator() {
  const ua = String(globalThis.navigator?.userAgent || "").toLowerCase();
  return ua.includes("simulator");
}

function shouldUseRotatedMapping() {
  const stored = LocalStore.get(ROTATED_DPAD_KEY, null);
  if (typeof stored === "boolean") {
    return stored;
  }
  return isSimulator();
}

function normalizeDirectionalKeyCode(code) {
  const rotatedMap = {
    37: 38,
    38: 37,
    39: 40,
    40: 39
  };
  if (shouldUseRotatedMapping() && rotatedMap[code]) {
    return rotatedMap[code];
  }
  return code;
}

function buildNormalizedEvent(event) {
  const key = String(event?.key || "");
  const code = String(event?.code || "");
  const arrowFromKey = getArrowCodeFromKey(key);
  const rawCode = Number(arrowFromKey || event.keyCode || 0);
  const normalizedCode = normalizeDirectionalKeyCode(rawCode);
  return {
    key,
    code,
    target: event?.target || null,
    altKey: Boolean(event?.altKey),
    ctrlKey: Boolean(event?.ctrlKey),
    shiftKey: Boolean(event?.shiftKey),
    metaKey: Boolean(event?.metaKey),
    repeat: Boolean(event?.repeat),
    defaultPrevented: Boolean(event?.defaultPrevented),
    keyCode: normalizedCode,
    which: normalizedCode,
    originalKeyCode: rawCode,
    preventDefault: () => {
      if (typeof event?.preventDefault === "function") {
        event.preventDefault();
      }
    },
    stopPropagation: () => {
      if (typeof event?.stopPropagation === "function") {
        event.stopPropagation();
      }
    },
    stopImmediatePropagation: () => {
      if (typeof event?.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
    }
  };
}

export const FocusEngine = {
  lastBackHandledAt: 0,

  init() {
    this.boundHandleKey = this.handleKey.bind(this);
    document.addEventListener("keydown", this.boundHandleKey, true);
  },

  handleKey(event) {
    if (event.defaultPrevented) {
      return;
    }

    const normalizedEvent = buildNormalizedEvent(event);

    if (isBackKey(event, normalizedEvent.keyCode)) {
      const now = Date.now();
      if (now - this.lastBackHandledAt < 180) {
        return;
      }
      this.lastBackHandledAt = now;
      if (typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      if (typeof event.stopPropagation === "function") {
        event.stopPropagation();
      }
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      const currentScreen = Router.getCurrentScreen();
      if (currentScreen?.consumeBackRequest?.()) {
        return;
      }
      Router.back();
      return;
    }

    const currentScreen = Router.getCurrentScreen();

    currentScreen?.onKeyDown?.(normalizedEvent);
  }
};
