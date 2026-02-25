import { Router } from "../../navigation/router.js";
import { AuthManager } from "../../../core/auth/authManager.js";
import { QrLoginService } from "../../../core/auth/qrLoginService.js";
import { LocalStore } from "../../../core/storage/localStore.js";

let pollInterval = null;
let countdownInterval = null;

export const AuthQrSignInScreen = {

  async mount({ onboardingMode = false } = {}) {
    const container = document.getElementById("account");
    container.style.display = "block";

    container.innerHTML = `
      <div class="qr-layout">

        <div class="qr-left">
          <img src="assets/brand/app_logo_wordmark.png" class="qr-logo"/>
          <h1>Sign in with QR</h1>
          <p class="qr-description">
            Use your phone to login with email/password.
          </p>
          <div id="qr-user-info"></div>
        </div>

        <div class="qr-right">
          <h2>Account Login</h2>
          <p>Scan QR, approve in browser, then return here.</p>

          <div id="qr-container"></div>
          <div id="qr-code-text"></div>
          <div id="qr-expiry"></div>
          <div id="qr-status"></div>

          <div class="qr-buttons">
            <button id="qr-refresh-btn">Refresh QR</button>
            <button id="qr-back-btn">${onboardingMode ? "Continue without account" : "Back"}</button>
          </div>
        </div>

      </div>
    `;

    document.getElementById("qr-refresh-btn").onclick = () => this.startQr();
    document.getElementById("qr-back-btn").onclick = () => {
      this.cleanup();
      if (onboardingMode) {
        Router.navigate("home");
      } else {
        Router.back();
      }
    };

    await this.startQr();
  },

  async startQr() {
    this.stopIntervals();

    const result = await QrLoginService.start();

    if (!result) {
      const raw = QrLoginService.getLastError();
      this.setStatus(this.toFriendlyQrError(raw));
      return;
    }

    this.renderQr(result);
    this.startPolling(result.code, result.deviceNonce, result.pollIntervalSeconds || 3);
    this.startCountdown(result.expiresAt);
  },

  renderQr({ qrImageUrl, code }) {
    const qrContainer = document.getElementById("qr-container");
    const codeText = document.getElementById("qr-code-text");

    qrContainer.innerHTML = `
      <img src="${qrImageUrl}" class="qr-image"/>
    `;

    codeText.innerText = `Code: ${code}`;
  },

  startCountdown(expiresAt) {
    const expiryEl = document.getElementById("qr-expiry");

    countdownInterval = setInterval(() => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        expiryEl.innerText = "Expired";
        clearInterval(countdownInterval);
        return;
      }

      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      expiryEl.innerText = `Expires in ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }, 1000);
  },

  startPolling(code, deviceNonce, pollIntervalSeconds = 3) {
    pollInterval = setInterval(async () => {
      const status = await QrLoginService.poll(code, deviceNonce);

      if (status === "approved") {
        this.setStatus("Approved. Finishing login...");
        clearInterval(pollInterval);

        const exchange = await QrLoginService.exchange(code, deviceNonce);

        if (exchange) {
          LocalStore.set("hasSeenAuthQrOnFirstLaunch", true);
          Router.navigate("profileSelection");
        } else {
          this.setStatus(this.toFriendlyQrError(QrLoginService.getLastError()));
        }
      }

      if (status === "expired") {
        this.setStatus("QR expired. Refresh to retry.");
      }

    }, Math.max(2, Number(pollIntervalSeconds || 3)) * 1000);
  },

  toFriendlyQrError(rawError) {
    const message = String(rawError || "").toLowerCase();
    if (!message) {
      return "QR unavailable. Try again.";
    }
    if (message.includes("invalid tv login redirect base url")) {
      return "QR backend redirect URL is invalid. Check TV login SQL setup.";
    }
    if (message.includes("start_tv_login_session") && message.includes("could not find the function")) {
      return "QR backend function is missing. Re-run TV login SQL setup.";
    }
    if (message.includes("gen_random_bytes") && message.includes("does not exist")) {
      return "QR backend missing extension. Re-run SQL setup for TV login.";
    }
    if (message.includes("network") || message.includes("failed to fetch")) {
      return "Network error while generating QR.";
    }
    return `QR unavailable: ${rawError}`;
  },

  setStatus(text) {
    const statusNode = document.getElementById("qr-status");
    if (!statusNode) {
      return;
    }
    statusNode.innerText = text;
  },

  stopIntervals() {
    if (pollInterval) clearInterval(pollInterval);
    if (countdownInterval) clearInterval(countdownInterval);
    pollInterval = null;
    countdownInterval = null;
  },

  cleanup() {
    this.stopIntervals();

    const container = document.getElementById("account");
    if (container) {
      container.innerHTML = "";
      container.style.display = "none";
    }
  }
};
