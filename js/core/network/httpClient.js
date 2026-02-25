import { SessionStore } from "../storage/sessionStore.js";

export async function httpRequest(url, options = {}) {

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (SessionStore.accessToken) {
    headers["Authorization"] = `Bearer ${SessionStore.accessToken}`;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(text);
    error.status = response.status;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.code === "string") {
          error.code = parsed.code;
        }
        if (typeof parsed.message === "string") {
          error.detail = parsed.message;
        }
      }
    } catch (parseError) {
      // Keep raw response text in error.message when payload is not JSON.
    }
    throw error;
  }

  if (response.status === 204) {
    return null;
  }
  const text = await response.text();
  const normalized = typeof text === "string" ? text.trim() : "";
  if (!normalized) {
    return null;
  }
  return JSON.parse(normalized);
}
