import { httpRequest } from "../../../core/network/httpClient.js";

function trimSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

export const AddonApi = {

  async getManifest(baseUrl) {
    return httpRequest(`${trimSlash(baseUrl)}/manifest.json`);
  },

  async getMeta(url) {
    return httpRequest(url);
  },

  async getStreams(url) {
    return httpRequest(url);
  },

  async getSubtitles(url) {
    return httpRequest(url);
  }

};
