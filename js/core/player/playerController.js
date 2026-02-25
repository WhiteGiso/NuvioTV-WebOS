import { watchProgressRepository } from "../../data/repository/watchProgressRepository.js";
import { WebOSPlayerExtensions } from "../../platform/webos/webosPlayerExtensions.js";
import { WatchProgressSyncService } from "../profile/watchProgressSyncService.js";

export const PlayerController = {

  video: null,
  isPlaying: false,
  currentItemId: null,
  currentItemType: null,
  currentVideoId: null,
  currentSeason: null,
  currentEpisode: null,
  progressSaveTimer: null,
  lastProgressPushAt: 0,
  lifecycleBound: false,
  lifecycleFlushHandler: null,
  visibilityFlushHandler: null,

  init() {
    this.video = document.getElementById("videoPlayer");
    WebOSPlayerExtensions.apply(this.video);

    this.video.addEventListener("ended", () => {
      console.log("Playback ended");
      this.isPlaying = false;
      const context = this.createProgressContext();
      this.flushProgress(0, 0, true, context);
    });

    this.video.addEventListener("error", (e) => {
      console.error("Video error:", e);
    });

    this.video.addEventListener("waiting", () => {
      console.log("Buffering...");
    });

    this.video.addEventListener("playing", () => {
      console.log("Playing");
    });

    if (!this.lifecycleBound) {
      this.lifecycleBound = true;
      this.lifecycleFlushHandler = () => {
        const context = this.createProgressContext();
        if (!context.itemId) {
          return;
        }
        this.flushProgress(
          Math.floor((this.video?.currentTime || 0) * 1000),
          Math.floor((this.video?.duration || 0) * 1000),
          false,
          context
        ).finally(() => {
          this.pushProgressIfDue(true);
        });
      };
      this.visibilityFlushHandler = () => {
        if (document.visibilityState === "hidden") {
          this.lifecycleFlushHandler?.();
        }
      };
      window.addEventListener("pagehide", this.lifecycleFlushHandler);
      window.addEventListener("beforeunload", this.lifecycleFlushHandler);
      document.addEventListener("visibilitychange", this.visibilityFlushHandler);
    }
  },

  play(url, { itemId = null, itemType = "movie", videoId = null, season = null, episode = null } = {}) {
    if (!this.video) return;

    this.currentItemId = itemId;
    this.currentItemType = itemType;
    this.currentVideoId = videoId;
    this.currentSeason = season == null ? null : Number(season);
    this.currentEpisode = episode == null ? null : Number(episode);
    this.video.src = url;
    this.video.load();
    this.video.play();
    this.isPlaying = true;

    if (this.progressSaveTimer) {
      clearInterval(this.progressSaveTimer);
    }

    this.progressSaveTimer = setInterval(() => {
      const context = this.createProgressContext();
      this.flushProgress(
        Math.floor((this.video.currentTime || 0) * 1000),
        Math.floor((this.video.duration || 0) * 1000),
        false,
        context
      );
    }, 5000);
  },

  pause() {
    if (!this.video) return;
    this.video.pause();
  },

  resume() {
    if (!this.video) return;
    this.video.play();
  },

  stop() {
    if (!this.video) return;

    const context = this.createProgressContext();
    this.flushProgress(
      Math.floor((this.video.currentTime || 0) * 1000),
      Math.floor((this.video.duration || 0) * 1000),
      false,
      context
    ).finally(() => {
      this.pushProgressIfDue(true);
    });

    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();

    this.isPlaying = false;
    this.currentItemId = null;
    this.currentItemType = null;
    this.currentVideoId = null;
    this.currentSeason = null;
    this.currentEpisode = null;

    if (this.progressSaveTimer) {
      clearInterval(this.progressSaveTimer);
      this.progressSaveTimer = null;
    }
  },

  createProgressContext() {
    return {
      itemId: this.currentItemId,
      itemType: this.currentItemType || "movie",
      videoId: this.currentVideoId || null,
      season: Number.isFinite(this.currentSeason) ? this.currentSeason : null,
      episode: Number.isFinite(this.currentEpisode) ? this.currentEpisode : null
    };
  },

  async flushProgress(positionMs, durationMs, clear = false, context = null) {
    const active = context || this.createProgressContext();
    if (!active?.itemId) {
      return;
    }

    const safePosition = Number(positionMs || 0);
    const safeDuration = Number(durationMs || 0);
    const hasFiniteDuration = Number.isFinite(safeDuration) && safeDuration > 0;

    if (clear || (hasFiniteDuration && safePosition / safeDuration > 0.95)) {
      await watchProgressRepository.removeProgress(active.itemId, active.videoId || null);
      this.pushProgressIfDue(true);
      return;
    }

    if (!Number.isFinite(safePosition) || safePosition <= 0) {
      return;
    }

    await watchProgressRepository.saveProgress({
      contentId: active.itemId,
      contentType: active.itemType || "movie",
      videoId: active.videoId || null,
      season: active.season,
      episode: active.episode,
      positionMs: Math.max(0, Math.trunc(safePosition)),
      durationMs: hasFiniteDuration ? Math.max(0, Math.trunc(safeDuration)) : 0
    });
    this.pushProgressIfDue(false);
  },

  pushProgressIfDue(force = false) {
    const now = Date.now();
    if (!force && (now - Number(this.lastProgressPushAt || 0)) < 30000) {
      return;
    }
    this.lastProgressPushAt = now;
    WatchProgressSyncService.push().catch((error) => {
      console.warn("Watch progress auto push failed", error);
    });
  }

};
