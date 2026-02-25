export const WebOSSystem = {

  closeApp() {
    if (window.webOSSystem && typeof window.webOSSystem.close === "function") {
      window.webOSSystem.close();
    }
  }

};
