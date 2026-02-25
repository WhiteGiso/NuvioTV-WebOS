export const Environment = {

  isWebOS() {
    return Boolean(window.webOS || window.PalmSystem || window.webOSSystem);
  },

  isBrowser() {
    return !this.isWebOS();
  }

};
