import { safeApiCall } from "../../core/network/safeApiCall.js";
import { addonRepository } from "./addonRepository.js";
import { SubtitleApi } from "../remote/api/subtitleApi.js";

class SubtitleRepository {

  async getSubtitles(type, id, videoId = null) {
    const addons = await addonRepository.getInstalledAddons();
    const subtitleAddons = addons.filter((addon) => addon.resources.some((resource) => {
      const resourceName = String(resource.name || "").toLowerCase();
      if (resourceName !== "subtitles" && resourceName !== "subtitle") {
        return false;
      }
      if (!resource.types || resource.types.length === 0) {
        return true;
      }
      return resource.types.some((resourceType) => resourceType === type);
    }));

    const allResults = await Promise.all(subtitleAddons.map(async (addon) => {
      const actualId = type === "series" && videoId ? videoId : id;
      const url = this.buildSubtitlesUrl(addon.baseUrl, type, actualId);
      const result = await safeApiCall(() => SubtitleApi.getSubtitles(url));
      if (result.status !== "success") {
        return [];
      }

      return (result.data?.subtitles || []).map((subtitle) => ({
        id: subtitle.id || `${subtitle.lang || "unk"}-${this.makeDeterministicId(subtitle.url || "")}`,
        url: subtitle.url,
        lang: subtitle.lang || "unknown",
        addonName: addon.displayName,
        addonLogo: addon.logo
      })).filter((subtitle) => Boolean(subtitle.url));
    }));

    return allResults.flat();
  }

  buildSubtitlesUrl(baseUrl, type, id) {
    const cleanBaseUrl = String(baseUrl || "").replace(/\/+$/, "");
    return `${cleanBaseUrl}/subtitles/${this.encode(type)}/${this.encode(id)}.json`;
  }

  encode(value) {
    return encodeURIComponent(String(value || "")).replace(/\+/g, "%20");
  }

  makeDeterministicId(value) {
    let hash = 0;
    const str = String(value || "");
    for (let index = 0; index < str.length; index += 1) {
      hash = ((hash << 5) - hash) + str.charCodeAt(index);
      hash |= 0;
    }
    return Math.abs(hash);
  }

}

export const subtitleRepository = new SubtitleRepository();
