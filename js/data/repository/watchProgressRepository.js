import { WatchProgressStore } from "../local/watchProgressStore.js";

class WatchProgressRepository {

  async saveProgress(progress) {
    WatchProgressStore.upsert({
      ...progress,
      updatedAt: progress.updatedAt || Date.now()
    });
  }

  async getProgressByContentId(contentId) {
    return WatchProgressStore.findByContentId(contentId);
  }

  async removeProgress(contentId, videoId = null) {
    WatchProgressStore.remove(contentId, videoId);
  }

  async getRecent(limit = 30) {
    const byContent = new Map();
    WatchProgressStore.list().forEach((item) => {
      if (!item?.contentId) {
        return;
      }
      const existing = byContent.get(item.contentId);
      if (!existing || Number(item.updatedAt || 0) > Number(existing.updatedAt || 0)) {
        byContent.set(item.contentId, item);
      }
    });
    return Array.from(byContent.values())
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
      .slice(0, limit);
  }

  async getAll() {
    return WatchProgressStore.list();
  }

  async replaceAll(items) {
    WatchProgressStore.replaceAll(items || []);
  }

}

export const watchProgressRepository = new WatchProgressRepository();
