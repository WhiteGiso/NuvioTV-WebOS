import { Router } from "./ui/navigation/router.js";
import { FocusEngine } from "./ui/navigation/focusEngine.js";
import { PlayerController } from "./core/player/playerController.js";
import { AuthManager } from "./core/auth/authManager.js";
import { AuthState } from "./core/auth/authState.js";
import { StartupSyncService } from "./core/profile/startupSyncService.js";
import { ThemeManager } from "./ui/theme/themeManager.js";

document.addEventListener("DOMContentLoaded", async () => {
  console.log("Nuvio LG starting...");

  Router.init();
  PlayerController.init();
  FocusEngine.init();
  ThemeManager.apply();

  AuthManager.subscribe((state) => {
    if (state === AuthState.LOADING) {
      StartupSyncService.stop();
      Router.navigate("splash");
    }

    if (state === AuthState.SIGNED_OUT) {
      StartupSyncService.stop();
      Router.navigate("authQrSignIn");
    }

    if (state === AuthState.AUTHENTICATED) {
      StartupSyncService.start();
      Router.navigate("profileSelection");
    }
  });

  await AuthManager.bootstrap();
});
