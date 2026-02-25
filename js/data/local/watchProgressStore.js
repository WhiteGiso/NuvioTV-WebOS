import { LocalStore } from "../../core/storage/localStore.js";

const WATCH_PROGRESS_KEY = "watchProgressItems";

function normalizeProgress(progress = {}) {
  const updatedAt = Number(progress.updatedAt || Date.now());
  const season = progress.season == null ? null : Number(progress.season);
  const episode = progress.episode == null ? null : Number(progress.episode);
  return {
    ...progress,
    contentId: String(progress.contentId || "").trim(),
    contentType: String(progress.contentType || "movie").trim() || "movie",
    videoId: progress.videoId == null ? null : String(progress.videoId),
    season: Number.isFinite(season) ? season : null,
    episode: Number.isFinite(episode) ? episode : null,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now()
  };
}

function progressKey(progress = {}) {
  const contentId = String(progress.contentId || "").trim();
  const videoId = progress.videoId == null ? "main" : String(progress.videoId).trim();
  const season = progress.season == null ? "" : String(Number(progress.season));
  const episode = progress.episode == null ? "" : String(Number(progress.episode));
  return `${contentId}::${videoId}::${season}::${episode}`;
}

function dedupeAndSort(items = []) {
  const byKey = new Map();
  (items || []).forEach((raw) => {
    const item = normalizeProgress(raw);
    if (!item.contentId) {
      return;
    }
    const key = progressKey(item);
    const existing = byKey.get(key);
    if (!existing || Number(item.updatedAt || 0) > Number(existing.updatedAt || 0)) {
      byKey.set(key, item);
    }
  });
  return Array.from(byKey.values())
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
}

export const WatchProgressStore = {

  list() {
    return dedupeAndSort(LocalStore.get(WATCH_PROGRESS_KEY, []));
  },

  upsert(progress) {
    const normalized = normalizeProgress(progress);
    if (!normalized.contentId) {
      return;
    }
    const items = this.list();
    const key = progressKey(normalized);
    const next = dedupeAndSort([
      normalized,
      ...items.filter((item) => progressKey(item) !== key)
    ]).slice(0, 500);
    LocalStore.set(WATCH_PROGRESS_KEY, next);
  },

  findByContentId(contentId) {
    const wanted = String(contentId || "").trim();
    return this.list().find((item) => item.contentId === wanted) || null;
  },

  remove(contentId, videoId = null) {
    const wantedContentId = String(contentId || "").trim();
    const wantedVideoId = videoId == null ? null : String(videoId);
    const next = this.list().filter((item) => {
      if (item.contentId !== wantedContentId) {
        return true;
      }
      if (wantedVideoId == null) {
        return false;
      }
      return String(item.videoId || "") !== wantedVideoId;
    });
    LocalStore.set(WATCH_PROGRESS_KEY, next);
  },

  replaceAll(items = []) {
    LocalStore.set(WATCH_PROGRESS_KEY, dedupeAndSort(Array.isArray(items) ? items : []).slice(0, 500));
  }

};
