export const WebOSInputHandler = {

  onBack(callback) {
    const handler = (event) => {
      if (event.keyCode === 461) {
        callback?.(event);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }

};
