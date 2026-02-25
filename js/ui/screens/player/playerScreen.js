import { PlayerController } from "../../../core/player/playerController.js";
import { subtitleRepository } from "../../../data/repository/subtitleRepository.js";
import { streamRepository } from "../../../data/repository/streamRepository.js";
import { Router } from "../../navigation/router.js";

function formatTime(secondsValue) {
  const total = Math.max(0, Math.floor(Number(secondsValue || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatClock(date = new Date()) {
  return date.toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function formatEndsAt(currentSeconds, durationSeconds) {
  const current = Number(currentSeconds || 0);
  const duration = Number(durationSeconds || 0);
  if (!Number.isFinite(duration) || duration <= 0) {
    return "--:--";
  }
  const remainingMs = Math.max(0, (duration - current) * 1000);
  const endDate = new Date(Date.now() + remainingMs);
  return formatClock(endDate);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function trackListToArray(trackList) {
  if (!trackList) {
    return [];
  }

  try {
    const iterableTracks = Array.from(trackList).filter(Boolean);
    if (iterableTracks.length) {
      return iterableTracks;
    }
  } catch (_) {
    // Some WebOS track lists are not iterable.
  }

  const length = Number(trackList.length || 0);
  if (Number.isFinite(length) && length > 0) {
    const indexedTracks = [];
    for (let index = 0; index < length; index += 1) {
      const track = trackList[index] || (typeof trackList.item === "function" ? trackList.item(index) : null);
      if (track) {
        indexedTracks.push(track);
      }
    }
    if (indexedTracks.length) {
      return indexedTracks;
    }
  }

  if (typeof trackList.item === "function") {
    const probedTracks = [];
    for (let index = 0; index < 32; index += 1) {
      const track = trackList.item(index);
      if (!track) {
        if (probedTracks.length) {
          break;
        }
        continue;
      }
      probedTracks.push(track);
    }
    if (probedTracks.length) {
      return probedTracks;
    }
  }

  const objectTracks = Object.keys(trackList)
    .filter((key) => /^\d+$/.test(key))
    .map((key) => trackList[key])
    .filter(Boolean);
  return objectTracks;
}

function normalizeItemType(value) {
  const normalized = String(value || "movie").toLowerCase();
  return normalized === "tv" ? "series" : normalized;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function qualityLabelFromText(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("2160") || text.includes("4k")) return "2160p";
  if (text.includes("1080")) return "1080p";
  if (text.includes("720")) return "720p";
  if (text.includes("480")) return "480p";
  return "Auto";
}

function flattenStreamGroups(streamResult) {
  if (!streamResult || streamResult.status !== "success") {
    return [];
  }
  return (streamResult.data || []).flatMap((group) => {
    const addonName = group.addonName || "Addon";
    return (group.streams || []).map((stream, index) => ({
      id: `${addonName}-${index}-${stream.url || ""}`,
      label: stream.title || stream.name || `${addonName} stream`,
      description: stream.description || stream.name || "",
      addonName,
      addonLogo: group.addonLogo || stream.addonLogo || null,
      sourceType: stream.type || stream.source || "",
      url: stream.url,
      raw: stream
    })).filter((entry) => Boolean(entry.url));
  });
}

function mergeStreamItems(existing = [], incoming = []) {
  const byKey = new Set();
  const merged = [];
  const push = (item) => {
    if (!item?.url) {
      return;
    }
    const key = [
      String(item.addonName || "Addon"),
      String(item.url || ""),
      String(item.sourceType || ""),
      String(item.label || "")
    ].join("::");
    if (byKey.has(key)) {
      return;
    }
    byKey.add(key);
    merged.push(item);
  };
  (existing || []).forEach(push);
  (incoming || []).forEach(push);
  return merged;
}

function normalizeParentalWarnings(source) {
  const severityRank = {
    severe: 0,
    moderate: 1,
    mild: 2,
    none: 99
  };

  if (Array.isArray(source)) {
    return source
      .map((entry) => ({
        label: String(entry?.label || "").trim(),
        severity: String(entry?.severity || "").trim()
      }))
      .filter((entry) => entry.label && entry.severity)
      .filter((entry) => entry.severity.toLowerCase() !== "none")
      .sort((left, right) => {
        const leftRank = severityRank[left.severity.toLowerCase()] ?? 50;
        const rightRank = severityRank[right.severity.toLowerCase()] ?? 50;
        return leftRank - rightRank;
      })
      .slice(0, 5);
  }

  const guide = source && typeof source === "object" ? source : null;
  if (!guide) {
    return [];
  }

  const labels = {
    nudity: "Nudity",
    violence: "Violence",
    profanity: "Profanity",
    alcohol: "Alcohol/Drugs",
    frightening: "Frightening"
  };

  return Object.entries(labels)
    .map(([key, label]) => {
      const severity = String(guide[key] || "").trim();
      if (!severity || severity.toLowerCase() === "none") {
        return null;
      }
      return { label, severity };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftRank = severityRank[left.severity.toLowerCase()] ?? 50;
      const rightRank = severityRank[right.severity.toLowerCase()] ?? 50;
      return leftRank - rightRank;
    })
    .slice(0, 5);
}

function stripQuotes(value) {
  const text = String(value || "").trim();
  if (text.startsWith("\"") && text.endsWith("\"")) {
    return text.slice(1, -1);
  }
  return text;
}

function parseHlsAttributeList(value) {
  const raw = String(value || "");
  const attributes = {};
  const regex = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    const key = String(match[1] || "").toUpperCase();
    const attributeValue = stripQuotes(match[2] || "");
    if (!key) {
      continue;
    }
    attributes[key] = attributeValue;
  }
  return attributes;
}

function resolveUrl(baseUrl, maybeRelativeUrl) {
  try {
    return new URL(String(maybeRelativeUrl || ""), String(baseUrl || "")).toString();
  } catch (_) {
    return String(maybeRelativeUrl || "");
  }
}

function uniqueNonEmptyValues(values = []) {
  const seen = new Set();
  const unique = [];
  (values || []).forEach((value) => {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    unique.push(normalized);
  });
  return unique;
}

export const PlayerScreen = {

  async mount(params = {}) {
    this.container = document.getElementById("player");
    this.container.style.display = "block";
    this.params = params;

    this.aspectModes = [
      { objectFit: "contain", label: "Fit" },
      { objectFit: "cover", label: "Fill" },
      { objectFit: "fill", label: "Stretch" }
    ];

    this.streamCandidates = this.normalizeStreamCandidates(Array.isArray(params.streamCandidates) ? params.streamCandidates : []);
    const initialStreamUrl = params.streamUrl || this.selectBestStreamUrl(this.streamCandidates) || null;
    if (!this.streamCandidates.length && initialStreamUrl) {
      this.streamCandidates = this.normalizeStreamCandidates([
        {
          url: initialStreamUrl,
          title: "Current source",
          addonName: "Current"
        }
      ]);
    }

    this.currentStreamIndex = this.streamCandidates.findIndex((stream) => stream.url === initialStreamUrl);
    if (this.currentStreamIndex < 0) {
      this.currentStreamIndex = 0;
    }

    this.subtitles = [];
    this.subtitleDialogVisible = false;
    this.subtitleDialogTab = "builtIn";
    this.subtitleDialogIndex = 0;
    this.selectedSubtitleTrackIndex = -1;
    this.selectedAddonSubtitleId = null;
    this.builtInSubtitleCount = 0;
    this.externalTrackNodes = [];

    this.audioDialogVisible = false;
    this.audioDialogIndex = 0;
    this.selectedAudioTrackIndex = -1;

    this.sourcesPanelVisible = false;
    this.sourcesLoading = false;
    this.sourcesError = "";
    this.sourceFilter = "all";
    this.sourcesFocus = { zone: "filter", index: 0 };
    this.sourceLoadToken = 0;

    this.aspectModeIndex = 0;
    this.aspectToastTimer = null;

    this.episodes = Array.isArray(params.episodes) ? params.episodes : [];
    this.episodePanelVisible = false;
    this.episodePanelIndex = Math.max(0, this.episodes.findIndex((entry) => entry.id === params.videoId));
    this.switchingEpisode = false;

    this.seekOverlayVisible = false;
    this.seekPreviewSeconds = null;
    this.seekPreviewDirection = 0;
    this.seekRepeatCount = 0;
    this.seekCommitTimer = null;
    this.seekOverlayTimer = null;

    this.parentalWarnings = normalizeParentalWarnings(params.parentalWarnings || params.parentalGuide);
    this.parentalGuideVisible = false;
    this.parentalGuideShown = false;
    this.parentalGuideTimer = null;
    this.subtitleSelectionTimer = null;
    this.subtitleLoadToken = 0;
    this.subtitleLoading = false;
    this.manifestLoadToken = 0;
    this.manifestLoading = false;
    this.manifestAudioTracks = [];
    this.manifestSubtitleTracks = [];
    this.manifestVariants = [];
    this.manifestMasterUrl = "";
    this.selectedManifestAudioTrackId = null;
    this.selectedManifestSubtitleTrackId = null;
    this.activePlaybackUrl = initialStreamUrl || null;
    this.pendingPlaybackRestore = null;
    this.trackDiscoveryToken = 0;
    this.trackDiscoveryInProgress = false;
    this.trackDiscoveryTimer = null;
    this.trackDiscoveryStartedAt = 0;
    this.trackDiscoveryDeadline = 0;
    this.lastTrackWarmupAt = 0;

    this.paused = false;
    this.controlsVisible = true;
    this.loadingVisible = true;
    this.moreActionsVisible = false;
    this.controlsHideTimer = null;
    this.tickTimer = null;
    this.videoListeners = [];

    this.renderPlayerUi();
    this.bindVideoEvents();
    this.renderEpisodePanel();
    this.applyAspectMode({ showToast: false });
    this.updateUiTick();

    if (initialStreamUrl) {
      PlayerController.play(initialStreamUrl, this.buildPlaybackContext());
      this.loadManifestTrackDataForCurrentStream(initialStreamUrl);
      this.startTrackDiscoveryWindow();
    }

    this.loadSubtitles();
    this.syncTrackState();
    this.tickTimer = setInterval(() => this.updateUiTick(), 1000);
    this.endedHandler = () => {
      this.handlePlaybackEnded();
    };
    PlayerController.video?.addEventListener("ended", this.endedHandler);
    this.setControlsVisible(true, { focus: true });
  },

  buildPlaybackContext() {
    return {
      itemId: this.params.itemId || null,
      itemType: normalizeItemType(this.params.itemType || "movie"),
      videoId: this.params.videoId || null,
      season: this.params.season == null ? null : Number(this.params.season),
      episode: this.params.episode == null ? null : Number(this.params.episode)
    };
  },

  buildSubtitleLookupContext() {
    const type = normalizeItemType(this.params?.itemType || "movie");
    const rawItemId = String(this.params?.itemId || "").trim();
    const baseItemId = rawItemId ? String(rawItemId.split(":")[0] || "").trim() : "";
    const id = baseItemId || rawItemId || "";

    let videoId = null;
    if (type === "series") {
      const season = Number(this.params?.season);
      const episode = Number(this.params?.episode);
      if (id && Number.isFinite(season) && season > 0 && Number.isFinite(episode) && episode > 0) {
        videoId = `${id}:${season}:${episode}`;
      } else if (this.params?.videoId) {
        videoId = String(this.params.videoId);
      }
    }

    return { type, id, videoId };
  },

  normalizeStreamCandidates(streams = []) {
    return (streams || []).map((stream, index) => {
      if (!stream?.url) {
        return null;
      }
      return {
        id: stream.id || `stream-${index}-${stream.url}`,
        label: stream.title || stream.name || stream.label || `Source ${index + 1}`,
        description: stream.description || stream.name || "",
        addonName: stream.addonName || stream.sourceName || "Addon",
        addonLogo: stream.addonLogo || null,
        sourceType: stream.type || stream.source || "",
        url: stream.url,
        raw: stream
      };
    }).filter(Boolean);
  },

  getCurrentStreamCandidate() {
    if (!this.streamCandidates.length) {
      return null;
    }
    const current = this.streamCandidates[this.currentStreamIndex] || null;
    if (current?.url) {
      return current;
    }
    return this.streamCandidates.find((entry) => Boolean(entry?.url)) || null;
  },

  getVideoTextTrackList() {
    const video = PlayerController.video;
    if (!video) {
      return null;
    }
    return video.textTracks || video.webkitTextTracks || video.mozTextTracks || null;
  },

  getVideoAudioTrackList() {
    const video = PlayerController.video;
    if (!video) {
      return null;
    }
    return video.audioTracks || video.webkitAudioTracks || video.mozAudioTracks || null;
  },

  collectStreamSidecarSubtitles(streamCandidate = this.getCurrentStreamCandidate()) {
    const mapSubtitles = (candidate) => {
      const stream = candidate?.raw || candidate || null;
      const rawSubtitles = Array.isArray(stream?.subtitles) ? stream.subtitles : [];
      return rawSubtitles
      .filter((subtitle) => Boolean(subtitle?.url))
      .map((subtitle, index) => ({
        id: subtitle.id || `${subtitle.lang || "unk"}-${index}-${subtitle.url}`,
        url: subtitle.url,
        lang: subtitle.lang || "unknown",
        addonName: candidate?.addonName || "Stream",
        addonLogo: candidate?.addonLogo || null
      }));
    };

    const current = mapSubtitles(streamCandidate);
    if (current.length) {
      return current;
    }

    return this.streamCandidates.flatMap((candidate) => mapSubtitles(candidate));
  },

  mergeSubtitleCandidates(primary = [], secondary = []) {
    const merged = [];
    const seen = new Set();
    [...(primary || []), ...(secondary || [])].forEach((subtitle) => {
      if (!subtitle?.url) {
        return;
      }
      const key = `${String(subtitle.url).trim()}::${String(subtitle.lang || "").trim().toLowerCase()}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      merged.push(subtitle);
    });
    return merged;
  },

  getCurrentStreamRequestHeaders(streamCandidate = this.getCurrentStreamCandidate()) {
    const stream = streamCandidate?.raw || streamCandidate || null;
    const requestHeaders = stream?.behaviorHints?.proxyHeaders?.request;
    if (!requestHeaders || typeof requestHeaders !== "object") {
      return {};
    }
    return { ...requestHeaders };
  },

  parseHlsManifestTracks(manifestText, manifestUrl) {
    const lines = String(manifestText || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const audioTracks = [];
    const subtitleTracks = [];
    const variants = [];
    let pendingVariantAttributes = null;

    lines.forEach((line) => {
      if (line.startsWith("#EXT-X-MEDIA:")) {
        const attributes = parseHlsAttributeList(line.slice("#EXT-X-MEDIA:".length));
        const mediaType = String(attributes.TYPE || "").toUpperCase();
        const groupId = String(attributes["GROUP-ID"] || "").trim();
        const name = String(attributes.NAME || attributes.LANGUAGE || "").trim();
        const language = String(attributes.LANGUAGE || "").trim();
        const uri = attributes.URI ? resolveUrl(manifestUrl, attributes.URI) : null;
        const isDefault = String(attributes.DEFAULT || "").toUpperCase() === "YES";
        const trackId = `${mediaType || "TRACK"}::${groupId || "main"}::${name || language || "default"}`;

        if (mediaType === "AUDIO") {
          audioTracks.push({
            id: trackId,
            groupId,
            name: name || `Audio ${audioTracks.length + 1}`,
            language,
            uri,
            isDefault
          });
          return;
        }

        if (mediaType === "SUBTITLES") {
          subtitleTracks.push({
            id: trackId,
            groupId,
            name: name || `Subtitle ${subtitleTracks.length + 1}`,
            language,
            uri,
            isDefault
          });
          return;
        }
        return;
      }

      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        pendingVariantAttributes = parseHlsAttributeList(line.slice("#EXT-X-STREAM-INF:".length));
        return;
      }

      if (line.startsWith("#")) {
        return;
      }

      if (!pendingVariantAttributes) {
        return;
      }

      variants.push({
        uri: resolveUrl(manifestUrl, line),
        audioGroupId: String(pendingVariantAttributes.AUDIO || "").trim() || null,
        subtitleGroupId: String(pendingVariantAttributes.SUBTITLES || "").trim() || null,
        bandwidth: Number(pendingVariantAttributes.BANDWIDTH || 0),
        resolution: String(pendingVariantAttributes.RESOLUTION || "").trim()
      });
      pendingVariantAttributes = null;
    });

    return {
      audioTracks,
      subtitleTracks,
      variants
    };
  },

  parseDashManifestTracks(manifestText) {
    const parseErrorResult = {
      audioTracks: [],
      subtitleTracks: [],
      variants: []
    };

    const parser = typeof DOMParser === "function" ? new DOMParser() : null;
    if (!parser) {
      return parseErrorResult;
    }

    let xmlDocument = null;
    try {
      xmlDocument = parser.parseFromString(String(manifestText || ""), "application/xml");
    } catch (_) {
      return parseErrorResult;
    }
    if (!xmlDocument) {
      return parseErrorResult;
    }
    if (xmlDocument.getElementsByTagName("parsererror").length > 0) {
      return parseErrorResult;
    }

    const adaptationSets = Array.from(xmlDocument.getElementsByTagName("AdaptationSet"));
    if (!adaptationSets.length) {
      return parseErrorResult;
    }

    const audioTracks = [];
    const subtitleTracks = [];
    adaptationSets.forEach((adaptationSet, setIndex) => {
      const contentType = String(adaptationSet.getAttribute("contentType") || "").toLowerCase();
      const mimeType = String(adaptationSet.getAttribute("mimeType") || "").toLowerCase();
      const codecs = String(adaptationSet.getAttribute("codecs") || "").toLowerCase();
      const representation = adaptationSet.getElementsByTagName("Representation")[0] || null;
      const role = adaptationSet.getElementsByTagName("Role")[0] || null;
      const language = String(
        adaptationSet.getAttribute("lang")
        || representation?.getAttribute("lang")
        || ""
      ).trim();
      const label = String(
        adaptationSet.getAttribute("label")
        || representation?.getAttribute("label")
        || role?.getAttribute("value")
        || ""
      ).trim();
      const setId = String(adaptationSet.getAttribute("id") || setIndex).trim();

      const isAudio = contentType === "audio" || mimeType.startsWith("audio/");
      const isSubtitle = contentType === "text"
        || mimeType.startsWith("text/")
        || mimeType.includes("ttml")
        || mimeType.includes("vtt")
        || codecs.includes("stpp")
        || codecs.includes("wvtt");

      if (isAudio) {
        audioTracks.push({
          id: `DASH::AUDIO::${setId}::${language || label || audioTracks.length + 1}`,
          groupId: setId,
          name: label || `Audio ${audioTracks.length + 1}`,
          language,
          uri: null,
          isDefault: audioTracks.length === 0
        });
      } else if (isSubtitle) {
        subtitleTracks.push({
          id: `DASH::SUBTITLES::${setId}::${language || label || subtitleTracks.length + 1}`,
          groupId: setId,
          name: label || `Subtitle ${subtitleTracks.length + 1}`,
          language,
          uri: null,
          isDefault: subtitleTracks.length === 0
        });
      }
    });

    return {
      audioTracks,
      subtitleTracks,
      variants: []
    };
  },

  parseManifestTracks(manifestText, manifestUrl) {
    const text = String(manifestText || "");
    if (!text) {
      return { audioTracks: [], subtitleTracks: [], variants: [] };
    }
    if (text.includes("#EXTM3U")) {
      return this.parseHlsManifestTracks(text, manifestUrl);
    }
    if (/<\s*MPD[\s>]/i.test(text)) {
      return this.parseDashManifestTracks(text);
    }
    return { audioTracks: [], subtitleTracks: [], variants: [] };
  },

  async loadManifestTrackDataForCurrentStream(playbackUrl = this.activePlaybackUrl) {
    const currentCandidate = this.getCurrentStreamCandidate();
    const masterUrl = currentCandidate?.url || playbackUrl || "";
    const runtimeUrl = String(PlayerController.video?.currentSrc || "").trim();
    const loadToken = (this.manifestLoadToken || 0) + 1;
    this.manifestLoadToken = loadToken;
    this.manifestLoading = true;

    this.manifestAudioTracks = [];
    this.manifestSubtitleTracks = [];
    this.manifestVariants = [];
    this.manifestMasterUrl = masterUrl;
    this.selectedManifestAudioTrackId = null;
    this.selectedManifestSubtitleTrackId = null;
    this.refreshTrackDialogs();

    if (!masterUrl) {
      if (loadToken === this.manifestLoadToken) {
        this.manifestLoading = false;
        this.refreshTrackDialogs();
      }
      return;
    }

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let timeoutId = null;
    if (controller) {
      timeoutId = setTimeout(() => controller.abort(), 5000);
    }

    try {
      const headers = this.getCurrentStreamRequestHeaders(currentCandidate);
      const fetchManifestText = async (url, requestHeaders = {}) => {
        const response = await fetch(url, {
          method: "GET",
          headers: requestHeaders,
          signal: controller?.signal
        });
        const text = await response.text();
        return {
          text,
          finalUrl: response.url || url
        };
      };

      const urlCandidates = uniqueNonEmptyValues([masterUrl, runtimeUrl, playbackUrl, this.activePlaybackUrl]);
      let selectedParsed = null;
      let selectedMasterUrl = masterUrl;

      for (const candidateUrl of urlCandidates) {
        let fetchedManifest = null;
        try {
          fetchedManifest = await fetchManifestText(candidateUrl, headers);
        } catch (_) {
          try {
            fetchedManifest = await fetchManifestText(candidateUrl, {});
          } catch (_) {
            fetchedManifest = null;
          }
        }

        if (loadToken !== this.manifestLoadToken) {
          return;
        }
        if (!fetchedManifest) {
          continue;
        }

        const parsed = this.parseManifestTracks(fetchedManifest.text, fetchedManifest.finalUrl || candidateUrl);
        const hasTracks = parsed.audioTracks.length || parsed.subtitleTracks.length;
        if (hasTracks) {
          selectedParsed = parsed;
          selectedMasterUrl = fetchedManifest.finalUrl || candidateUrl;
          break;
        }

        if (!selectedParsed && (parsed.variants.length > 0)) {
          selectedParsed = parsed;
          selectedMasterUrl = fetchedManifest.finalUrl || candidateUrl;
        }

        if (parsed.variants.length > 0) {
          const variant = parsed.variants[0];
          if (!variant?.uri) {
            continue;
          }
          try {
            const variantFetched = await fetchManifestText(variant.uri, headers);
            if (loadToken !== this.manifestLoadToken) {
              return;
            }
            const nestedParsed = this.parseManifestTracks(variantFetched.text, variantFetched.finalUrl || variant.uri);
            if (nestedParsed.audioTracks.length || nestedParsed.subtitleTracks.length) {
              selectedParsed = nestedParsed;
              selectedMasterUrl = variantFetched.finalUrl || variant.uri;
              break;
            }
            if (!selectedParsed && nestedParsed.variants.length > 0) {
              selectedParsed = nestedParsed;
              selectedMasterUrl = variantFetched.finalUrl || variant.uri;
            }
          } catch (_) {
            try {
              const variantFetchedNoHeaders = await fetchManifestText(variant.uri, {});
              if (loadToken !== this.manifestLoadToken) {
                return;
              }
              const nestedParsed = this.parseManifestTracks(variantFetchedNoHeaders.text, variantFetchedNoHeaders.finalUrl || variant.uri);
              if (nestedParsed.audioTracks.length || nestedParsed.subtitleTracks.length) {
                selectedParsed = nestedParsed;
                selectedMasterUrl = variantFetchedNoHeaders.finalUrl || variant.uri;
                break;
              }
              if (!selectedParsed && nestedParsed.variants.length > 0) {
                selectedParsed = nestedParsed;
                selectedMasterUrl = variantFetchedNoHeaders.finalUrl || variant.uri;
              }
            } catch (_) {
              // Ignore nested manifest failures.
            }
          }
        }
      }

      if (!selectedParsed) {
        return;
      }

      this.manifestMasterUrl = selectedMasterUrl || masterUrl;
      this.manifestAudioTracks = selectedParsed.audioTracks;
      this.manifestSubtitleTracks = selectedParsed.subtitleTracks;
      this.manifestVariants = selectedParsed.variants;
      this.selectedManifestAudioTrackId = selectedParsed.audioTracks.find((track) => track.isDefault)?.id || selectedParsed.audioTracks[0]?.id || null;
      this.selectedManifestSubtitleTrackId = selectedParsed.subtitleTracks.find((track) => track.isDefault)?.id || null;
      this.refreshTrackDialogs();
    } catch (error) {
      // Ignore parsing failures on providers that block manifest fetch.
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (loadToken === this.manifestLoadToken) {
        this.manifestLoading = false;
        this.refreshTrackDialogs();
      }
    }
  },

  pickManifestVariant({ audioGroupId = null, subtitleGroupId = null } = {}) {
    if (!this.manifestVariants.length) {
      return null;
    }

    const byAudio = audioGroupId
      ? this.manifestVariants.filter((variant) => variant.audioGroupId === audioGroupId)
      : this.manifestVariants.slice();
    const candidatePool = byAudio.length ? byAudio : this.manifestVariants;

    if (subtitleGroupId) {
      const bySubtitle = candidatePool.filter((variant) => variant.subtitleGroupId === subtitleGroupId);
      if (bySubtitle.length) {
        return bySubtitle[0];
      }
    }

    if (subtitleGroupId === null) {
      const withoutSubtitle = candidatePool.filter((variant) => !variant.subtitleGroupId);
      if (withoutSubtitle.length) {
        return withoutSubtitle[0];
      }
    }

    return candidatePool[0] || null;
  },

  applyManifestTrackSelection({ audioTrackId, subtitleTrackId } = {}) {
    if (audioTrackId !== undefined) {
      this.selectedManifestAudioTrackId = audioTrackId;
    }
    if (subtitleTrackId !== undefined) {
      this.selectedManifestSubtitleTrackId = subtitleTrackId;
    }

    const selectedAudio = this.manifestAudioTracks.find((track) => track.id === this.selectedManifestAudioTrackId) || null;
    const selectedSubtitle = this.manifestSubtitleTracks.find((track) => track.id === this.selectedManifestSubtitleTrackId) || null;
    const variant = this.pickManifestVariant({
      audioGroupId: selectedAudio?.groupId || null,
      subtitleGroupId: selectedSubtitle ? (selectedSubtitle.groupId || null) : null
    });

    if (!variant?.uri) {
      this.refreshTrackDialogs();
      return;
    }

    const targetUrl = variant.uri;
    if (targetUrl === this.activePlaybackUrl) {
      this.refreshTrackDialogs();
      return;
    }

    const video = PlayerController.video;
    const restoreTimeSeconds = Number(video?.currentTime || 0);
    const restorePaused = Boolean(this.paused || video?.paused);
    this.pendingPlaybackRestore = {
      timeSeconds: Number.isFinite(restoreTimeSeconds) ? restoreTimeSeconds : 0,
      paused: restorePaused
    };

    this.activePlaybackUrl = targetUrl;
    PlayerController.play(targetUrl, this.buildPlaybackContext());
    this.paused = false;
    this.loadingVisible = true;
    this.updateLoadingVisibility();
    this.setControlsVisible(true, { focus: false });
  },

  renderPlayerUi() {
    this.container.querySelector("#playerUiRoot")?.remove();

    const root = document.createElement("div");
    root.id = "playerUiRoot";
    root.className = "player-ui-root";

    root.innerHTML = `
      <div id="playerLoadingOverlay" class="player-loading-overlay">
        <div class="player-loading-backdrop"${this.params.playerBackdropUrl ? ` style="background-image:url('${this.params.playerBackdropUrl}')"` : ""}></div>
        <div class="player-loading-gradient"></div>
        <div class="player-loading-center">
          ${this.params.playerLogoUrl ? `<img class="player-loading-logo" src="${this.params.playerLogoUrl}" alt="logo" />` : ""}
          <div class="player-loading-title">${escapeHtml(this.params.playerTitle || this.params.itemId || "Nuvio")}</div>
          ${this.params.playerSubtitle ? `<div class="player-loading-subtitle">${escapeHtml(this.params.playerSubtitle)}</div>` : ""}
        </div>
      </div>

      <div id="playerParentalGuide" class="player-parental-guide hidden"></div>

      <div id="playerAspectToast" class="player-aspect-toast hidden"></div>

      <div id="playerSeekOverlay" class="player-seek-overlay hidden">
        <div class="player-seek-overlay-top">
          <span id="playerSeekDirection" class="player-seek-direction"></span>
          <span id="playerSeekPreview" class="player-seek-preview">0:00</span>
        </div>
        <div class="player-seek-track"><div id="playerSeekFill" class="player-seek-fill"></div></div>
      </div>

      <div id="playerModalBackdrop" class="player-modal-backdrop hidden"></div>
      <div id="playerSubtitleDialog" class="player-modal player-subtitle-modal hidden"></div>
      <div id="playerAudioDialog" class="player-modal player-audio-modal hidden"></div>
      <div id="playerSourcesPanel" class="player-sources-panel hidden"></div>

      <div id="playerControlsOverlay" class="player-controls-overlay">
        <div class="player-controls-top">
          <div id="playerClock" class="player-clock">--:--</div>
          <div class="player-ends-at">Ends at: <span id="playerEndsAt">--:--</span></div>
        </div>

        <div class="player-controls-bottom">
          <div class="player-meta">
            <div class="player-title">${escapeHtml(this.params.playerTitle || this.params.itemId || "Untitled")}</div>
            <div class="player-subtitle">${escapeHtml(this.params.playerSubtitle || this.params.episodeLabel || this.params.itemType || "")}</div>
          </div>

          <div class="player-progress-track">
            <div id="playerProgressFill" class="player-progress-fill"></div>
          </div>

          <div class="player-controls-row">
            <div id="playerControlButtons" class="player-control-buttons"></div>
            <div id="playerTimeLabel" class="player-time-label">0:00 / 0:00</div>
          </div>
        </div>
      </div>
    `;

    this.container.appendChild(root);
    this.renderControlButtons();
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSourcesPanel();
    this.renderParentalGuideOverlay();
    this.renderSeekOverlay();
  },

  updateModalBackdrop() {
    const modalBackdrop = this.container.querySelector("#playerModalBackdrop");
    if (!modalBackdrop) {
      return;
    }
    const hasModal = this.subtitleDialogVisible || this.audioDialogVisible || this.sourcesPanelVisible;
    modalBackdrop.classList.toggle("hidden", !hasModal);
  },

  bindVideoEvents() {
    const video = PlayerController.video;
    if (!video) {
      return;
    }

    const onWaiting = () => {
      this.loadingVisible = true;
      this.updateLoadingVisibility();
      if (!this.sourcesPanelVisible) {
        this.setControlsVisible(true, { focus: false });
      }
    };

    const onPlaying = () => {
      this.loadingVisible = false;
      this.paused = false;
      this.updateLoadingVisibility();
      this.refreshTrackDialogs();
      this.updateUiTick();
      this.resetControlsAutoHide();
      if (!this.parentalGuideShown && this.parentalWarnings.length) {
        this.showParentalGuideOverlay();
      }
    };

    const onPause = () => {
      if (video.ended) {
        return;
      }
      this.paused = true;
      this.setControlsVisible(true, { focus: false });
      this.updateUiTick();
      this.renderControlButtons();
    };

    const onTimeUpdate = () => {
      this.updateUiTick();
    };

    const onLoadedMetadata = () => {
      if (this.pendingPlaybackRestore) {
        const restore = this.pendingPlaybackRestore;
        this.pendingPlaybackRestore = null;
        if (Number.isFinite(restore.timeSeconds) && restore.timeSeconds > 0) {
          try {
            video.currentTime = restore.timeSeconds;
          } catch (_) {
            // Ignore seek restore failures.
          }
        }
        if (restore.paused) {
          PlayerController.pause();
          this.paused = true;
        } else {
          this.paused = false;
        }
      }

      this.refreshTrackDialogs();
      this.updateUiTick();
      this.loadingVisible = false;
      this.updateLoadingVisibility();
      this.ensureTrackDataWarmup();
      this.startTrackDiscoveryWindow({ durationMs: 5000, intervalMs: 300 });
    };

    const onPlayable = () => {
      this.refreshTrackDialogs();
      this.updateUiTick();
    };

    const onTrackListChanged = () => {
      this.refreshTrackDialogs();
      if (this.trackDiscoveryInProgress && this.hasAudioTracksAvailable() && this.hasSubtitleTracksAvailable()) {
        this.trackDiscoveryInProgress = false;
        this.clearTrackDiscoveryTimer();
        this.refreshTrackDialogs();
      }
    };

    const bindings = [
      ["waiting", onWaiting],
      ["playing", onPlaying],
      ["pause", onPause],
      ["timeupdate", onTimeUpdate],
      ["loadedmetadata", onLoadedMetadata],
      ["loadeddata", onPlayable],
      ["canplay", onPlayable]
    ];

    bindings.forEach(([eventName, handler]) => {
      video.addEventListener(eventName, handler);
      this.videoListeners.push({ target: video, eventName, handler });
    });

    const trackTargets = [this.getVideoTextTrackList(), this.getVideoAudioTrackList()].filter(Boolean);
    trackTargets.forEach((target) => {
      if (typeof target.addEventListener !== "function") {
        return;
      }
      ["addtrack", "removetrack", "change"].forEach((eventName) => {
        target.addEventListener(eventName, onTrackListChanged);
        this.videoListeners.push({ target, eventName, handler: onTrackListChanged });
      });
    });
  },

  unbindVideoEvents() {
    this.videoListeners.forEach(({ target, eventName, handler }) => {
      target?.removeEventListener?.(eventName, handler);
    });
    this.videoListeners = [];
  },

  getControlDefinitions() {
    const base = [
      {
        action: "playPause",
        label: this.paused ? ">" : "II",
        icon: this.paused ? "assets/icons/ic_player_play.svg" : "assets/icons/ic_player_pause.svg",
        title: "Play/Pause"
      },
      { action: "subtitleDialog", icon: "assets/icons/ic_player_subtitles.svg", title: "Subtitles" },
      {
        action: "audioTrack",
        icon: this.selectedAudioTrackIndex >= 0 || this.selectedManifestAudioTrackId
          ? "assets/icons/ic_player_audio_filled.svg"
          : "assets/icons/ic_player_audio_outline.svg",
        title: "Audio"
      },
      { action: "source", icon: "assets/icons/ic_player_source.svg", title: "Sources" },
      { action: "episodes", icon: "assets/icons/ic_player_episodes.svg", title: "Episodes" },
      { action: "more", label: this.moreActionsVisible ? "<" : ">", title: "More" }
    ];

    if (!this.moreActionsVisible) {
      return base;
    }

    return [
      ...base.slice(0, Math.max(0, base.length - 1)),
      { action: "aspect", icon: "assets/icons/ic_player_aspect_ratio.svg", title: "Display Mode" },
      { action: "source", icon: "assets/icons/ic_player_source.svg", title: "Sources" },
      { action: "backFromMore", label: "<", title: "Back" }
    ];
  },

  renderControlButtons() {
    const wrap = this.container.querySelector("#playerControlButtons");
    if (!wrap) {
      return;
    }

    const currentAction = wrap.querySelector(".player-control-btn.focused")?.dataset?.action || "";
    const controls = this.getControlDefinitions();

    wrap.innerHTML = controls.map((control) => `
      <button class="player-control-btn focusable"
              data-action="${control.action}"
              title="${escapeHtml(control.title || "")}">
        ${control.icon
          ? `<img class="player-control-icon" src="${control.icon}" alt="" aria-hidden="true" />`
          : `<span class="player-control-label">${escapeHtml(control.label || "")}</span>`}
      </button>
    `).join("");

    const preferred = wrap.querySelector(`.player-control-btn[data-action="${currentAction}"]`)
      || wrap.querySelector(".player-control-btn");

    if (preferred) {
      preferred.classList.add("focused");
    }
  },

  isDialogOpen() {
    return this.subtitleDialogVisible || this.audioDialogVisible || this.sourcesPanelVisible || this.episodePanelVisible;
  },

  setControlsVisible(visible, { focus = false } = {}) {
    this.controlsVisible = Boolean(visible);
    const overlay = this.container.querySelector("#playerControlsOverlay");
    if (!overlay) {
      return;
    }
    overlay.classList.toggle("hidden", !this.controlsVisible);
    if (this.controlsVisible) {
      this.renderControlButtons();
      if (focus) {
        this.focusFirstControl();
      }
      this.resetControlsAutoHide();
    } else {
      this.clearControlsAutoHide();
    }
  },

  focusFirstControl() {
    const buttons = Array.from(this.container.querySelectorAll(".player-control-btn"));
    if (!buttons.length) {
      return;
    }
    buttons.forEach((node) => node.classList.remove("focused"));
    buttons[0].classList.add("focused");
    buttons[0].focus();
  },

  clearControlsAutoHide() {
    if (this.controlsHideTimer) {
      clearTimeout(this.controlsHideTimer);
      this.controlsHideTimer = null;
    }
  },

  resetControlsAutoHide() {
    this.clearControlsAutoHide();
    if (!this.controlsVisible || this.paused || this.isDialogOpen() || this.seekOverlayVisible) {
      return;
    }
    this.controlsHideTimer = setTimeout(() => {
      this.setControlsVisible(false);
    }, 4200);
  },

  updateLoadingVisibility() {
    const overlay = this.container.querySelector("#playerLoadingOverlay");
    if (!overlay) {
      return;
    }
    overlay.classList.toggle("hidden", !this.loadingVisible);
  },

  updateUiTick() {
    const video = PlayerController.video;
    const current = Number(video?.currentTime || 0);
    const duration = Number(video?.duration || 0);
    const progress = duration > 0 ? clamp(current / duration, 0, 1) : 0;

    const progressFill = this.container.querySelector("#playerProgressFill");
    if (progressFill) {
      progressFill.style.width = `${Math.round(progress * 10000) / 100}%`;
    }

    const clock = this.container.querySelector("#playerClock");
    if (clock) {
      clock.textContent = formatClock(new Date());
    }

    const endsAt = this.container.querySelector("#playerEndsAt");
    if (endsAt) {
      endsAt.textContent = formatEndsAt(current, duration);
    }

    const timeLabel = this.container.querySelector("#playerTimeLabel");
    if (timeLabel) {
      timeLabel.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
    }

    if (this.seekOverlayVisible && this.seekPreviewSeconds == null) {
      this.renderSeekOverlay();
    }
  },
  renderSeekOverlay() {
    const overlay = this.container.querySelector("#playerSeekOverlay");
    const directionNode = this.container.querySelector("#playerSeekDirection");
    const previewNode = this.container.querySelector("#playerSeekPreview");
    const fillNode = this.container.querySelector("#playerSeekFill");
    if (!overlay || !directionNode || !previewNode || !fillNode) {
      return;
    }

    const video = PlayerController.video;
    const duration = Number(video?.duration || 0);
    const currentPreview = this.seekPreviewSeconds != null
      ? Number(this.seekPreviewSeconds)
      : Number(video?.currentTime || 0);

    overlay.classList.toggle("hidden", !this.seekOverlayVisible);
    previewNode.textContent = `${formatTime(currentPreview)} / ${formatTime(duration)}`;
    directionNode.textContent = this.seekPreviewDirection < 0 ? "<<" : this.seekPreviewDirection > 0 ? ">>" : "";

    const percent = duration > 0 ? clamp(currentPreview / duration, 0, 1) : 0;
    fillNode.style.width = `${Math.round(percent * 10000) / 100}%`;
  },

  beginSeekPreview(direction, isRepeat = false) {
    const video = PlayerController.video;
    if (!video || Number.isNaN(video.currentTime)) {
      return;
    }

    if (direction !== this.seekPreviewDirection || !isRepeat) {
      this.seekRepeatCount = 0;
    }
    this.seekPreviewDirection = direction;
    this.seekRepeatCount += 1;

    const stepSeconds = this.seekRepeatCount >= 10 ? 30 : this.seekRepeatCount >= 4 ? 20 : 10;
    const duration = Number(video.duration || 0);
    const base = this.seekPreviewSeconds == null ? Number(video.currentTime || 0) : Number(this.seekPreviewSeconds);
    let next = base + (direction * stepSeconds);
    if (duration > 0) {
      next = clamp(next, 0, duration);
    } else {
      next = Math.max(0, next);
    }

    this.seekPreviewSeconds = next;
    this.seekOverlayVisible = true;
    this.renderSeekOverlay();

    if (this.seekOverlayTimer) {
      clearTimeout(this.seekOverlayTimer);
      this.seekOverlayTimer = null;
    }

    this.scheduleSeekPreviewCommit();
  },

  scheduleSeekPreviewCommit() {
    if (this.seekCommitTimer) {
      clearTimeout(this.seekCommitTimer);
    }
    this.seekCommitTimer = setTimeout(() => {
      this.commitSeekPreview();
    }, 280);
  },

  commitSeekPreview() {
    const video = PlayerController.video;
    if (!video) {
      this.cancelSeekPreview({ commit: false });
      return;
    }

    if (this.seekPreviewSeconds != null) {
      video.currentTime = Number(this.seekPreviewSeconds);
    }

    this.seekPreviewSeconds = null;
    this.seekRepeatCount = 0;
    if (this.seekCommitTimer) {
      clearTimeout(this.seekCommitTimer);
      this.seekCommitTimer = null;
    }

    this.seekOverlayVisible = true;
    this.renderSeekOverlay();

    if (this.seekOverlayTimer) {
      clearTimeout(this.seekOverlayTimer);
    }
    this.seekOverlayTimer = setTimeout(() => {
      this.seekOverlayVisible = false;
      this.seekPreviewDirection = 0;
      this.renderSeekOverlay();
      this.resetControlsAutoHide();
    }, 700);
  },

  cancelSeekPreview({ commit = false } = {}) {
    if (commit) {
      this.commitSeekPreview();
      return;
    }

    if (this.seekCommitTimer) {
      clearTimeout(this.seekCommitTimer);
      this.seekCommitTimer = null;
    }
    if (this.seekOverlayTimer) {
      clearTimeout(this.seekOverlayTimer);
      this.seekOverlayTimer = null;
    }

    this.seekPreviewSeconds = null;
    this.seekPreviewDirection = 0;
    this.seekRepeatCount = 0;
    this.seekOverlayVisible = false;
    this.renderSeekOverlay();
  },

  togglePause() {
    if (this.paused) {
      PlayerController.resume();
      this.paused = false;
      this.setControlsVisible(true, { focus: false });
      this.renderControlButtons();
      return;
    }

    PlayerController.pause();
    this.paused = true;
    this.setControlsVisible(true, { focus: true });
    this.renderControlButtons();
  },

  async playStreamByUrl(streamUrl, { preservePanel = false } = {}) {
    if (!streamUrl) {
      return;
    }

    const selectedIndex = this.streamCandidates.findIndex((entry) => entry.url === streamUrl);
    if (selectedIndex >= 0) {
      this.currentStreamIndex = selectedIndex;
    }

    this.loadingVisible = true;
    this.updateLoadingVisibility();
    this.cancelSeekPreview({ commit: false });

    if (!preservePanel) {
      this.closeSourcesPanel();
    }

    this.subtitleDialogVisible = false;
    this.audioDialogVisible = false;
    this.selectedAddonSubtitleId = null;
    this.selectedSubtitleTrackIndex = -1;
    this.builtInSubtitleCount = 0;
    this.trackDiscoveryInProgress = true;
    this.clearTrackDiscoveryTimer();
    this.updateModalBackdrop();
    this.renderSubtitleDialog();
    this.renderAudioDialog();

    this.activePlaybackUrl = streamUrl;
    PlayerController.play(streamUrl, this.buildPlaybackContext());
    this.paused = false;
    this.loadSubtitles();
    this.loadManifestTrackDataForCurrentStream(streamUrl);
    this.startTrackDiscoveryWindow();
    this.syncTrackState();
    this.updateUiTick();
    this.setControlsVisible(true, { focus: false });
  },

  switchStream(direction) {
    if (!this.streamCandidates.length) {
      return;
    }

    this.currentStreamIndex += direction;
    if (this.currentStreamIndex >= this.streamCandidates.length) {
      this.currentStreamIndex = 0;
    }
    if (this.currentStreamIndex < 0) {
      this.currentStreamIndex = this.streamCandidates.length - 1;
    }

    const selected = this.streamCandidates[this.currentStreamIndex];
    if (!selected?.url) {
      return;
    }
    this.playStreamByUrl(selected.url);
  },

  getSubtitleTabs() {
    return [
      { id: "builtIn", label: "Built-in" },
      { id: "addons", label: "Addons" },
      { id: "style", label: "Style" },
      { id: "delay", label: "Delay" }
    ];
  },

  refreshTrackDialogs() {
    this.syncTrackState();
    this.renderControlButtons();
    if (this.subtitleDialogVisible) {
      this.renderSubtitleDialog();
    }
    if (this.audioDialogVisible) {
      this.renderAudioDialog();
    }
  },

  hasAudioTracksAvailable() {
    let nativeCount = 0;
    try {
      nativeCount = this.getAudioTracks().length;
    } catch (_) {
      nativeCount = 0;
    }
    return nativeCount > 0 || this.manifestAudioTracks.length > 0;
  },

  hasSubtitleTracksAvailable() {
    let nativeCount = 0;
    try {
      nativeCount = this.getTextTracks().length;
    } catch (_) {
      nativeCount = 0;
    }
    return nativeCount > 0 || this.manifestSubtitleTracks.length > 0 || this.subtitles.length > 0;
  },

  clearTrackDiscoveryTimer() {
    if (this.trackDiscoveryTimer) {
      clearTimeout(this.trackDiscoveryTimer);
      this.trackDiscoveryTimer = null;
    }
  },

  startTrackDiscoveryWindow({ durationMs = 7000, intervalMs = 350 } = {}) {
    const token = (this.trackDiscoveryToken || 0) + 1;
    this.trackDiscoveryToken = token;
    this.trackDiscoveryInProgress = true;
    this.trackDiscoveryStartedAt = Date.now();
    this.trackDiscoveryDeadline = this.trackDiscoveryStartedAt + Math.max(500, Number(durationMs || 0));
    this.clearTrackDiscoveryTimer();

    const tick = () => {
      if (token !== this.trackDiscoveryToken) {
        return;
      }

      const doneByData = this.hasAudioTracksAvailable() || this.hasSubtitleTracksAvailable();
      const doneByIdle = !this.subtitleLoading
        && !this.manifestLoading
        && (Date.now() - Number(this.trackDiscoveryStartedAt || 0)) >= 1200;
      const doneByTimeout = Date.now() >= this.trackDiscoveryDeadline;
      this.refreshTrackDialogs();

      if (doneByData || doneByIdle || doneByTimeout) {
        this.trackDiscoveryInProgress = false;
        this.clearTrackDiscoveryTimer();
        this.refreshTrackDialogs();
        return;
      }

      this.trackDiscoveryTimer = setTimeout(tick, Math.max(120, Number(intervalMs || 0)));
    };

    tick();
  },

  ensureTrackDataWarmup(force = false) {
    const now = Date.now();
    if (!force && (now - Number(this.lastTrackWarmupAt || 0)) < 1200) {
      return;
    }
    if (!force && (this.subtitleLoading || this.manifestLoading)) {
      this.startTrackDiscoveryWindow();
      return;
    }
    this.lastTrackWarmupAt = now;
    this.loadSubtitles();
    this.loadManifestTrackDataForCurrentStream(this.activePlaybackUrl || this.getCurrentStreamCandidate()?.url || null);
    this.startTrackDiscoveryWindow();
  },

  getTextTracks() {
    const trackList = this.getVideoTextTrackList();
    if (!trackList) {
      return [];
    }
    try {
      return trackListToArray(trackList);
    } catch (_) {
      return [];
    }
  },

  getAudioTracks() {
    const trackList = this.getVideoAudioTrackList();
    if (!trackList) {
      return [];
    }
    try {
      return trackListToArray(trackList);
    } catch (_) {
      return [];
    }
  },

  resolveBuiltInSubtitleBoundary(textTracks = this.getTextTracks()) {
    const trackCount = textTracks.length;
    if (!trackCount) {
      return 0;
    }

    if (Number.isFinite(this.builtInSubtitleCount) && this.builtInSubtitleCount > 0) {
      return clamp(this.builtInSubtitleCount, 0, trackCount);
    }

    if (this.externalTrackNodes.length > 0) {
      const inferred = trackCount - this.externalTrackNodes.length;
      if (inferred >= 0) {
        return clamp(inferred, 0, trackCount);
      }
      return trackCount;
    }

    return trackCount;
  },

  syncTrackState() {
    const textTracks = this.getTextTracks();
    const audioTracks = this.getAudioTracks();

    if (!this.externalTrackNodes.length) {
      this.builtInSubtitleCount = textTracks.length;
    } else if ((!Number.isFinite(this.builtInSubtitleCount) || this.builtInSubtitleCount <= 0) && textTracks.length > this.externalTrackNodes.length) {
      this.builtInSubtitleCount = textTracks.length - this.externalTrackNodes.length;
    }

    this.selectedSubtitleTrackIndex = textTracks.findIndex((track) => track?.mode && track.mode !== "disabled");
    this.selectedAudioTrackIndex = audioTracks.findIndex((track) => Boolean(track?.enabled || track?.selected));
  },

  getSubtitleEntries(tab = this.subtitleDialogTab) {
    const textTracks = this.getTextTracks();
    const builtInBoundary = this.resolveBuiltInSubtitleBoundary(textTracks);

    const builtInTracks = textTracks.filter((_, index) => index < builtInBoundary);
    const addonTracks = textTracks.filter((_, index) => index >= builtInBoundary);
    const trackDiscoveryPending = this.trackDiscoveryInProgress || this.subtitleLoading || this.manifestLoading;

    if (tab === "builtIn") {
      if (!builtInTracks.length && this.manifestSubtitleTracks.length) {
        return [
          {
            id: "subtitle-off",
            label: "None",
            secondary: "",
            selected: !this.selectedManifestSubtitleTrackId,
            trackIndex: -1,
            manifestSubtitleTrackId: null
          },
          ...this.manifestSubtitleTracks.map((track) => ({
            id: `subtitle-manifest-${track.id}`,
            label: track.name || "Subtitle",
            secondary: String(track.language || "").toUpperCase(),
            selected: this.selectedManifestSubtitleTrackId === track.id,
            trackIndex: null,
            manifestSubtitleTrackId: track.id
          }))
        ];
      }

      const entries = [
        {
          id: "subtitle-off",
          label: "None",
          secondary: "",
          selected: this.selectedSubtitleTrackIndex < 0 && !this.selectedManifestSubtitleTrackId,
          trackIndex: -1
        },
        ...builtInTracks.map((track, index) => ({
          id: `subtitle-built-${index}`,
          label: track.label || `Subtitle ${index + 1}`,
          secondary: String(track.language || "").toUpperCase(),
          selected: index === this.selectedSubtitleTrackIndex,
          trackIndex: index
        }))
      ];

      if (builtInTracks.length || !trackDiscoveryPending) {
        return entries;
      }

      return [
        ...entries,
        {
          id: "subtitle-builtin-loading",
          label: "Loading subtitle tracks...",
          secondary: "",
          selected: false,
          disabled: true,
          trackIndex: null
        }
      ];
    }

    if (tab === "addons") {
      if (!addonTracks.length) {
        if (this.subtitles.length) {
          return this.subtitles.slice(0, 16).map((subtitle, index) => {
            const subtitleId = subtitle.id || subtitle.url || `subtitle-${index}`;
            return {
              id: `subtitle-addon-fallback-${subtitleId}`,
              label: subtitle.lang || `Addon subtitle ${index + 1}`,
              secondary: subtitle.addonName || "Addon",
              selected: this.selectedAddonSubtitleId === subtitleId,
              trackIndex: null,
              subtitleIndex: index,
              fallbackAddonSubtitle: true
            };
          });
        }
        if (this.subtitleLoading || this.trackDiscoveryInProgress) {
          return [
            {
              id: "subtitle-addon-loading",
              label: "Loading addon subtitles...",
              secondary: "",
              selected: false,
              disabled: true,
              trackIndex: null
            }
          ];
        }
        return [
          {
            id: "subtitle-addon-empty",
            label: "No addon subtitles",
            secondary: "",
            selected: false,
            disabled: true,
            trackIndex: null
          }
        ];
      }
      return addonTracks.map((track, relativeIndex) => {
        const absoluteIndex = builtInBoundary + relativeIndex;
        return {
          id: `subtitle-addon-${absoluteIndex}`,
          label: track.label || `Addon subtitle ${relativeIndex + 1}`,
          secondary: String(track.language || "").toUpperCase(),
          selected: absoluteIndex === this.selectedSubtitleTrackIndex,
          trackIndex: absoluteIndex
        };
      });
    }

    if (tab === "style") {
      return [
        {
          id: "subtitle-style-default",
          label: "Default",
          secondary: "System style",
          selected: true,
          disabled: true,
          trackIndex: null
        }
      ];
    }

    return [
      {
        id: "subtitle-delay-default",
        label: "0.0s",
        secondary: "Delay control not available in web player",
        selected: true,
        disabled: true,
        trackIndex: null
      }
    ];
  },
  openSubtitleDialog() {
    this.cancelSeekPreview({ commit: false });
    this.syncTrackState();
    this.subtitleDialogVisible = true;
    this.audioDialogVisible = false;
    this.sourcesPanelVisible = false;
    const textTracks = this.getTextTracks();
    const builtInBoundary = this.resolveBuiltInSubtitleBoundary(textTracks);
    const hasBuiltInTracks = builtInBoundary > 0;
    const hasAddonTracks = textTracks.length > builtInBoundary || this.subtitles.length > 0;
    this.subtitleDialogTab = !hasBuiltInTracks && hasAddonTracks ? "addons" : "builtIn";
    let entries = this.getSubtitleEntries(this.subtitleDialogTab);
    if (!hasBuiltInTracks && !hasAddonTracks && !this.manifestSubtitleTracks.length) {
      this.ensureTrackDataWarmup();
      entries = this.getSubtitleEntries(this.subtitleDialogTab);
    }
    const selected = entries.findIndex((entry) => entry.selected);
    this.subtitleDialogIndex = Math.max(0, selected >= 0 ? selected : 0);
    this.setControlsVisible(true, { focus: false });
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSourcesPanel();
    this.updateModalBackdrop();
  },

  closeSubtitleDialog() {
    this.subtitleDialogVisible = false;
    this.renderSubtitleDialog();
    this.updateModalBackdrop();
    this.resetControlsAutoHide();
  },

  cycleSubtitleTab(delta) {
    const tabs = this.getSubtitleTabs();
    const index = tabs.findIndex((tab) => tab.id === this.subtitleDialogTab);
    const nextIndex = clamp(index + delta, 0, tabs.length - 1);
    this.subtitleDialogTab = tabs[nextIndex].id;
    const entries = this.getSubtitleEntries(this.subtitleDialogTab);
    const selected = entries.findIndex((entry) => entry.selected);
    this.subtitleDialogIndex = Math.max(0, selected >= 0 ? selected : 0);
    this.renderSubtitleDialog();
  },

  applySubtitleEntry(entry) {
    if (!entry || entry.disabled) {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(entry, "manifestSubtitleTrackId")) {
      this.applyManifestTrackSelection({ subtitleTrackId: entry.manifestSubtitleTrackId });
      this.selectedSubtitleTrackIndex = -1;
      this.selectedAddonSubtitleId = null;
      this.renderControlButtons();
      this.renderSubtitleDialog();
      return;
    }

    if (entry.fallbackAddonSubtitle) {
      this.applyFallbackAddonSubtitle(entry.subtitleIndex);
      return;
    }

    const textTracks = this.getTextTracks();
    const targetIndex = Number(entry.trackIndex);

    textTracks.forEach((track, index) => {
      try {
        track.mode = index === targetIndex ? "showing" : "disabled";
      } catch (_) {
        // Best effort: some WebOS builds expose readonly mode.
      }
    });

    if (targetIndex < 0) {
      textTracks.forEach((track) => {
        try {
          track.mode = "disabled";
        } catch (_) {
          // Best effort.
        }
      });
    }

    this.selectedAddonSubtitleId = null;
    this.selectedSubtitleTrackIndex = targetIndex;
    this.renderControlButtons();
    this.renderSubtitleDialog();
  },

  applyFallbackAddonSubtitle(subtitleIndex) {
    const subtitle = this.subtitles[subtitleIndex];
    if (!subtitle?.url) {
      return;
    }

    const video = PlayerController.video;
    if (!video) {
      return;
    }

    this.externalTrackNodes.forEach((node) => node.remove());
    this.externalTrackNodes = [];

    const track = document.createElement("track");
    track.kind = "subtitles";
    track.label = subtitle.lang || `Sub ${subtitleIndex + 1}`;
    track.srclang = (subtitle.lang || "und").slice(0, 2).toLowerCase();
    track.src = subtitle.url;
    track.default = true;
    video.appendChild(track);
    this.externalTrackNodes.push(track);

    if (this.subtitleSelectionTimer) {
      clearTimeout(this.subtitleSelectionTimer);
      this.subtitleSelectionTimer = null;
    }

    this.subtitleSelectionTimer = setTimeout(() => {
      const textTracks = this.getTextTracks();
      const builtInBoundary = this.resolveBuiltInSubtitleBoundary(textTracks);
      if (textTracks.length > builtInBoundary) {
        textTracks.forEach((textTrack, index) => {
          try {
            textTrack.mode = index === builtInBoundary ? "showing" : "disabled";
          } catch (_) {
            // Best effort.
          }
        });
      }
      this.refreshTrackDialogs();
    }, 160);

    this.selectedAddonSubtitleId = subtitle.id || subtitle.url || `subtitle-${subtitleIndex}`;
    this.renderControlButtons();
    this.renderSubtitleDialog();
  },

  renderSubtitleDialog() {
    const dialog = this.container.querySelector("#playerSubtitleDialog");
    if (!dialog) {
      return;
    }

    dialog.classList.toggle("hidden", !this.subtitleDialogVisible);
    if (!this.subtitleDialogVisible) {
      dialog.innerHTML = "";
      return;
    }

    const tabs = this.getSubtitleTabs();
    const entries = this.getSubtitleEntries(this.subtitleDialogTab);
    const focusIndex = clamp(this.subtitleDialogIndex, 0, Math.max(0, entries.length - 1));
    this.subtitleDialogIndex = focusIndex;

    dialog.innerHTML = `
      <div class="player-dialog-title">Subtitles</div>
      <div class="player-dialog-tabs">
        ${tabs.map((tab) => `
          <div class="player-dialog-tab${tab.id === this.subtitleDialogTab ? " selected" : ""}">
            ${escapeHtml(tab.label)}
          </div>
        `).join("")}
      </div>
      <div class="player-dialog-list">
        ${entries.map((entry, index) => `
          <div class="player-dialog-item${entry.selected ? " selected" : ""}${index === focusIndex ? " focused" : ""}${entry.disabled ? " disabled" : ""}">
            <div class="player-dialog-item-main">${escapeHtml(entry.label || "")}</div>
            <div class="player-dialog-item-sub">${escapeHtml(entry.secondary || "")}</div>
            <div class="player-dialog-item-check">${entry.selected ? "?" : ""}</div>
          </div>
        `).join("")}
      </div>
    `;
  },

  handleSubtitleDialogKey(event) {
    const keyCode = Number(event?.keyCode || 0);
    const entries = this.getSubtitleEntries(this.subtitleDialogTab);

    if (keyCode === 37) {
      this.cycleSubtitleTab(-1);
      return true;
    }
    if (keyCode === 39) {
      this.cycleSubtitleTab(1);
      return true;
    }
    if (keyCode === 38) {
      this.subtitleDialogIndex = clamp(this.subtitleDialogIndex - 1, 0, Math.max(0, entries.length - 1));
      this.renderSubtitleDialog();
      return true;
    }
    if (keyCode === 40) {
      this.subtitleDialogIndex = clamp(this.subtitleDialogIndex + 1, 0, Math.max(0, entries.length - 1));
      this.renderSubtitleDialog();
      return true;
    }
    if (keyCode === 13) {
      this.applySubtitleEntry(entries[this.subtitleDialogIndex]);
      return true;
    }

    return false;
  },

  getAudioEntries() {
    const audioTracks = this.getAudioTracks();
    if (audioTracks.length) {
      return audioTracks.map((track, index) => ({
        id: `audio-track-${index}`,
        label: track.label || `Track ${index + 1}`,
        secondary: String(track.language || "").toUpperCase(),
        selected: index === this.selectedAudioTrackIndex,
        audioTrackIndex: index
      }));
    }

    if (this.manifestAudioTracks.length) {
      return this.manifestAudioTracks.map((track) => ({
        id: `audio-manifest-${track.id}`,
        label: track.name || "Audio",
        secondary: String(track.language || "").toUpperCase(),
        selected: this.selectedManifestAudioTrackId === track.id,
        manifestAudioTrackId: track.id
      }));
    }

    return [];
  },

  openAudioDialog() {
    this.cancelSeekPreview({ commit: false });
    this.syncTrackState();
    this.audioDialogVisible = true;
    this.subtitleDialogVisible = false;
    this.sourcesPanelVisible = false;
    let entries = this.getAudioEntries();
    if (!entries.length) {
      this.ensureTrackDataWarmup();
      entries = this.getAudioEntries();
    }
    const selectedEntry = entries.findIndex((entry) => entry.selected);
    this.audioDialogIndex = Math.max(0, selectedEntry >= 0 ? selectedEntry : 0);
    this.setControlsVisible(true, { focus: false });
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSourcesPanel();
    this.updateModalBackdrop();
  },

  closeAudioDialog() {
    this.audioDialogVisible = false;
    this.renderAudioDialog();
    this.updateModalBackdrop();
    this.resetControlsAutoHide();
  },

  applyAudioTrack(index) {
    const entries = this.getAudioEntries();
    const selectedEntry = entries[index] || null;
    if (!selectedEntry) {
      return;
    }

    if (selectedEntry.manifestAudioTrackId) {
      this.applyManifestTrackSelection({ audioTrackId: selectedEntry.manifestAudioTrackId });
      this.renderControlButtons();
      this.renderAudioDialog();
      return;
    }

    const audioTracks = this.getAudioTracks();
    if (!audioTracks.length || index < 0 || index >= audioTracks.length) {
      return;
    }

    audioTracks.forEach((track, trackIndex) => {
      const selected = trackIndex === index;
      try {
        if ("enabled" in track) {
          track.enabled = selected;
        }
      } catch (_) {
        // Best effort.
      }
      try {
        if ("selected" in track) {
          track.selected = selected;
        }
      } catch (_) {
        // Best effort.
      }
    });
    this.selectedAudioTrackIndex = index;
    this.renderControlButtons();
    this.renderAudioDialog();
  },

  renderAudioDialog() {
    const dialog = this.container.querySelector("#playerAudioDialog");
    if (!dialog) {
      return;
    }

    dialog.classList.toggle("hidden", !this.audioDialogVisible);
    if (!this.audioDialogVisible) {
      dialog.innerHTML = "";
      return;
    }

    const entries = this.getAudioEntries();
    if (!entries.length) {
      const loading = this.manifestLoading || this.trackDiscoveryInProgress;
      dialog.innerHTML = `
        <div class="player-dialog-title">Audio</div>
        <div class="player-dialog-empty">${loading ? "Loading audio tracks..." : "No audio tracks available."}</div>
      `;
      return;
    }

    this.audioDialogIndex = clamp(this.audioDialogIndex, 0, entries.length - 1);

    dialog.innerHTML = `
      <div class="player-dialog-title">Audio</div>
      <div class="player-dialog-list">
        ${entries.map((entry, index) => {
          const selected = entry.selected;
          const focused = index === this.audioDialogIndex;
          return `
            <div class="player-dialog-item${selected ? " selected" : ""}${focused ? " focused" : ""}">
              <div class="player-dialog-item-main">${escapeHtml(entry.label || "")}</div>
              <div class="player-dialog-item-sub">${escapeHtml(entry.secondary || "")}</div>
              <div class="player-dialog-item-check">${selected ? "?" : ""}</div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  },

  handleAudioDialogKey(event) {
    const keyCode = Number(event?.keyCode || 0);
    const entries = this.getAudioEntries();

    if (!entries.length) {
      return true;
    }

    if (keyCode === 38) {
      this.audioDialogIndex = clamp(this.audioDialogIndex - 1, 0, entries.length - 1);
      this.renderAudioDialog();
      return true;
    }

    if (keyCode === 40) {
      this.audioDialogIndex = clamp(this.audioDialogIndex + 1, 0, entries.length - 1);
      this.renderAudioDialog();
      return true;
    }

    if (keyCode === 13) {
      this.applyAudioTrack(this.audioDialogIndex);
      return true;
    }

    return false;
  },

  getSourceFilters() {
    const addons = Array.from(new Set(this.streamCandidates.map((stream) => stream.addonName).filter(Boolean)));
    return ["all", ...addons];
  },

  getFilteredSources() {
    if (this.sourceFilter === "all") {
      return this.streamCandidates;
    }
    return this.streamCandidates.filter((stream) => stream.addonName === this.sourceFilter);
  },

  ensureSourcesFocus() {
    const filters = this.getSourceFilters();
    const list = this.getFilteredSources();

    if (!this.sourcesFocus || !["top", "filter", "list"].includes(this.sourcesFocus.zone)) {
      this.sourcesFocus = { zone: "filter", index: 0 };
    }

    if (this.sourcesFocus.zone === "top") {
      this.sourcesFocus.index = clamp(this.sourcesFocus.index, 0, 1);
      return;
    }

    if (this.sourcesFocus.zone === "filter") {
      this.sourcesFocus.index = clamp(this.sourcesFocus.index, 0, Math.max(0, filters.length - 1));
      return;
    }

    this.sourcesFocus.index = clamp(this.sourcesFocus.index, 0, Math.max(0, list.length - 1));
    if (!list.length && filters.length) {
      this.sourcesFocus = { zone: "filter", index: 0 };
    }
  },
  setSourceFilter(filter) {
    const available = this.getSourceFilters();
    if (!available.includes(filter)) {
      this.sourceFilter = "all";
      return;
    }
    this.sourceFilter = filter;
    this.sourcesFocus = { zone: "filter", index: clamp(available.indexOf(filter), 0, available.length - 1) };
  },

  openSourcesPanel({ forceReload = false } = {}) {
    this.cancelSeekPreview({ commit: false });
    this.sourcesPanelVisible = true;
    this.subtitleDialogVisible = false;
    this.audioDialogVisible = false;
    this.moreActionsVisible = false;

    const filters = this.getSourceFilters();
    this.sourcesFocus = { zone: "filter", index: clamp(filters.indexOf(this.sourceFilter), 0, Math.max(0, filters.length - 1)) };

    this.renderControlButtons();
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSourcesPanel();
    this.updateModalBackdrop();

    if (forceReload || !this.streamCandidates.length) {
      this.reloadSources();
    }
  },

  closeSourcesPanel() {
    this.sourcesPanelVisible = false;
    this.sourcesError = "";
    this.renderSourcesPanel();
    this.updateModalBackdrop();
    this.resetControlsAutoHide();
  },

  async reloadSources() {
    if (this.sourcesLoading) {
      return;
    }

    const type = normalizeItemType(this.params?.itemType || "movie");
    const videoId = String(this.params?.videoId || this.params?.itemId || "");
    if (!videoId) {
      return;
    }

    const token = this.sourceLoadToken + 1;
    this.sourceLoadToken = token;
    this.sourcesLoading = true;
    this.sourcesError = "";
    this.renderSourcesPanel();

    const options = {
      itemId: String(this.params?.itemId || ""),
      season: this.params?.season ?? null,
      episode: this.params?.episode ?? null,
      onChunk: (chunkResult) => {
        if (token !== this.sourceLoadToken) {
          return;
        }
        const chunkItems = flattenStreamGroups(chunkResult);
        if (!chunkItems.length) {
          return;
        }
        this.streamCandidates = mergeStreamItems(this.streamCandidates, chunkItems);
        this.renderSourcesPanel();
      }
    };

    try {
      const result = await streamRepository.getStreamsFromAllAddons(type, videoId, options);
      if (token !== this.sourceLoadToken) {
        return;
      }
      const merged = mergeStreamItems(this.streamCandidates, flattenStreamGroups(result));
      if (merged.length) {
        this.streamCandidates = merged;
      }
    } catch (error) {
      if (token === this.sourceLoadToken) {
        this.sourcesError = "Failed to load sources";
      }
    } finally {
      if (token === this.sourceLoadToken) {
        this.sourcesLoading = false;
        this.renderSourcesPanel();
      }
    }
  },

  renderSourcesPanel() {
    const panel = this.container.querySelector("#playerSourcesPanel");
    if (!panel) {
      return;
    }

    panel.classList.toggle("hidden", !this.sourcesPanelVisible);
    if (!this.sourcesPanelVisible) {
      panel.innerHTML = "";
      return;
    }

    const filters = this.getSourceFilters();
    const filtered = this.getFilteredSources();
    this.ensureSourcesFocus();

    panel.innerHTML = `
      <div class="player-sources-header">
        <div class="player-sources-title">Sources</div>
        <div class="player-sources-actions">
          <button class="player-sources-top-btn${this.sourcesFocus.zone === "top" && this.sourcesFocus.index === 0 ? " focused" : ""}" data-top-action="reload">Reload</button>
          <button class="player-sources-top-btn${this.sourcesFocus.zone === "top" && this.sourcesFocus.index === 1 ? " focused" : ""}" data-top-action="close">Close</button>
        </div>
      </div>

      <div class="player-sources-filters">
        ${filters.map((filter, index) => {
          const selected = this.sourceFilter === filter;
          const focused = this.sourcesFocus.zone === "filter" && this.sourcesFocus.index === index;
          return `
            <div class="player-sources-filter${selected ? " selected" : ""}${focused ? " focused" : ""}">
              ${escapeHtml(filter === "all" ? "All" : filter)}
            </div>
          `;
        }).join("")}
      </div>

      <div class="player-sources-list">
        ${this.sourcesLoading ? `<div class="player-sources-empty">Loading sources...</div>` : ""}
        ${this.sourcesError ? `<div class="player-sources-empty">${escapeHtml(this.sourcesError)}</div>` : ""}
        ${!this.sourcesLoading && !filtered.length
          ? `<div class="player-sources-empty">No sources found.</div>`
          : filtered.map((stream, index) => {
            const focused = this.sourcesFocus.zone === "list" && this.sourcesFocus.index === index;
            const isCurrent = this.streamCandidates[this.currentStreamIndex]?.url === stream.url;
            return `
              <article class="player-source-card${focused ? " focused" : ""}${isCurrent ? " selected" : ""}">
                <div class="player-source-main">
                  <div class="player-source-title">${escapeHtml(stream.label || "Stream")}</div>
                  <div class="player-source-desc">${escapeHtml(stream.description || stream.addonName || "")}</div>
                  <div class="player-source-tags">
                    <span class="player-source-tag">${escapeHtml(qualityLabelFromText(`${stream.label} ${stream.description}`))}</span>
                    <span class="player-source-tag">${escapeHtml(String(stream.sourceType || "stream") || "stream")}</span>
                  </div>
                </div>
                <div class="player-source-side">
                  <div class="player-source-addon">${escapeHtml(stream.addonName || "Addon")}</div>
                  ${isCurrent ? `<div class="player-source-playing">Playing</div>` : ""}
                </div>
              </article>
            `;
          }).join("")}
      </div>
    `;

    const focusedCard = panel.querySelector(".player-source-card.focused");
    if (focusedCard) {
      focusedCard.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  },

  moveSourcesFocus(direction) {
    const filters = this.getSourceFilters();
    const list = this.getFilteredSources();
    const zone = this.sourcesFocus.zone;
    let index = Number(this.sourcesFocus.index || 0);

    if (zone === "top") {
      if (direction === "left") {
        this.sourcesFocus = { zone: "top", index: clamp(index - 1, 0, 1) };
        return;
      }
      if (direction === "right") {
        this.sourcesFocus = { zone: "top", index: clamp(index + 1, 0, 1) };
        return;
      }
      if (direction === "down") {
        if (filters.length) {
          this.sourcesFocus = { zone: "filter", index: clamp(filters.indexOf(this.sourceFilter), 0, filters.length - 1) };
        } else if (list.length) {
          this.sourcesFocus = { zone: "list", index: 0 };
        }
        return;
      }
      return;
    }

    if (zone === "filter") {
      if (direction === "left") {
        this.sourcesFocus = { zone: "filter", index: clamp(index - 1, 0, Math.max(0, filters.length - 1)) };
        return;
      }
      if (direction === "right") {
        this.sourcesFocus = { zone: "filter", index: clamp(index + 1, 0, Math.max(0, filters.length - 1)) };
        return;
      }
      if (direction === "up") {
        this.sourcesFocus = { zone: "top", index: 0 };
        return;
      }
      if (direction === "down" && list.length) {
        this.sourcesFocus = { zone: "list", index: clamp(index, 0, list.length - 1) };
      }
      return;
    }

    if (zone === "list") {
      if (direction === "up") {
        if (index > 0) {
          this.sourcesFocus = { zone: "list", index: index - 1 };
        } else if (filters.length) {
          this.sourcesFocus = { zone: "filter", index: clamp(filters.indexOf(this.sourceFilter), 0, filters.length - 1) };
        } else {
          this.sourcesFocus = { zone: "top", index: 0 };
        }
        return;
      }
      if (direction === "down") {
        this.sourcesFocus = { zone: "list", index: clamp(index + 1, 0, Math.max(0, list.length - 1)) };
      }
    }
  },

  async activateSourcesFocus() {
    const zone = this.sourcesFocus.zone;
    const index = Number(this.sourcesFocus.index || 0);
    const filters = this.getSourceFilters();
    const list = this.getFilteredSources();

    if (zone === "top") {
      if (index === 0) {
        await this.reloadSources();
        return;
      }
      this.closeSourcesPanel();
      return;
    }

    if (zone === "filter") {
      const selected = filters[clamp(index, 0, Math.max(0, filters.length - 1))] || "all";
      this.setSourceFilter(selected);
      this.renderSourcesPanel();
      return;
    }

    const selectedStream = list[clamp(index, 0, Math.max(0, list.length - 1))] || null;
    if (selectedStream?.url) {
      await this.playStreamByUrl(selectedStream.url);
    }
  },

  async handleSourcesPanelKey(event) {
    const keyCode = Number(event?.keyCode || 0);
    if (keyCode === 82) {
      await this.reloadSources();
      return true;
    }

    if (keyCode === 37) {
      this.moveSourcesFocus("left");
      this.renderSourcesPanel();
      return true;
    }
    if (keyCode === 39) {
      this.moveSourcesFocus("right");
      this.renderSourcesPanel();
      return true;
    }
    if (keyCode === 38) {
      this.moveSourcesFocus("up");
      this.renderSourcesPanel();
      return true;
    }
    if (keyCode === 40) {
      this.moveSourcesFocus("down");
      this.renderSourcesPanel();
      return true;
    }
    if (keyCode === 13) {
      await this.activateSourcesFocus();
      return true;
    }

    return false;
  },

  showAspectToast(label) {
    const toast = this.container.querySelector("#playerAspectToast");
    if (!toast) {
      return;
    }

    toast.textContent = label;
    toast.classList.remove("hidden");

    if (this.aspectToastTimer) {
      clearTimeout(this.aspectToastTimer);
    }

    this.aspectToastTimer = setTimeout(() => {
      toast.classList.add("hidden");
    }, 1400);
  },

  applyAspectMode({ showToast = false } = {}) {
    const mode = this.aspectModes[this.aspectModeIndex] || this.aspectModes[0];
    const video = PlayerController.video;
    if (video) {
      video.style.objectFit = mode.objectFit;
    }
    if (showToast) {
      this.showAspectToast(mode.label);
    }
  },

  cycleAspectMode() {
    this.aspectModeIndex = (this.aspectModeIndex + 1) % this.aspectModes.length;
    this.applyAspectMode({ showToast: true });
  },
  renderParentalGuideOverlay() {
    const overlay = this.container.querySelector("#playerParentalGuide");
    if (!overlay) {
      return;
    }

    overlay.classList.toggle("hidden", !this.parentalGuideVisible || !this.parentalWarnings.length);
    if (!this.parentalGuideVisible || !this.parentalWarnings.length) {
      overlay.innerHTML = "";
      return;
    }

    overlay.innerHTML = `
      <div class="player-parental-line"></div>
      <div class="player-parental-list">
        ${this.parentalWarnings.map((warning, index) => `
          <div class="player-parental-item" style="animation-delay:${index * 120}ms">
            <span class="player-parental-label">${escapeHtml(warning.label)}</span>
            <span class="player-parental-severity">${escapeHtml(warning.severity)}</span>
          </div>
        `).join("")}
      </div>
    `;
  },

  showParentalGuideOverlay() {
    if (!this.parentalWarnings.length) {
      return;
    }

    this.parentalGuideVisible = true;
    this.parentalGuideShown = true;
    this.renderParentalGuideOverlay();

    if (this.parentalGuideTimer) {
      clearTimeout(this.parentalGuideTimer);
    }

    this.parentalGuideTimer = setTimeout(() => {
      this.parentalGuideVisible = false;
      this.renderParentalGuideOverlay();
    }, 5200);
  },

  toggleEpisodePanel() {
    if (!this.episodes.length) {
      return;
    }
    if (this.episodePanelVisible) {
      this.hideEpisodePanel();
      return;
    }
    this.episodePanelVisible = true;
    this.subtitleDialogVisible = false;
    this.audioDialogVisible = false;
    this.sourcesPanelVisible = false;
    this.updateModalBackdrop();
    this.setControlsVisible(true, { focus: false });
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSourcesPanel();
    this.renderEpisodePanel();
  },

  moveEpisodePanel(delta) {
    if (!this.episodePanelVisible || !this.episodes.length) {
      return;
    }
    const lastIndex = this.episodes.length - 1;
    this.episodePanelIndex = clamp(this.episodePanelIndex + delta, 0, lastIndex);
    this.renderEpisodePanel();
  },

  renderEpisodePanel() {
    this.container.querySelector("#episodeSidePanel")?.remove();
    if (!this.episodePanelVisible) {
      return;
    }
    const panel = document.createElement("div");
    panel.id = "episodeSidePanel";
    panel.className = "player-episode-panel";

    const cards = this.episodes.slice(0, 80).map((episode, index) => {
      const selected = index === this.episodePanelIndex;
      const selectedClass = selected ? " selected" : "";
      return `
        <div class="player-episode-item${selectedClass}">
          <div class="player-episode-item-title">S${episode.season}E${episode.episode} ${escapeHtml(episode.title || "Episode")}</div>
          <div class="player-episode-item-subtitle">${escapeHtml(episode.overview || "")}</div>
        </div>
      `;
    }).join("");

    panel.innerHTML = `
      <div class="player-episode-panel-title">Episodes</div>
      <div class="player-episode-panel-hint">UP/DOWN select, OK play, BACK close</div>
      ${cards}
    `;
    this.container.appendChild(panel);
  },

  hideEpisodePanel() {
    this.episodePanelVisible = false;
    this.container?.querySelector("#episodeSidePanel")?.remove();
    this.resetControlsAutoHide();
  },

  async playEpisodeFromPanel() {
    if (this.switchingEpisode || !this.episodes.length) {
      return;
    }
    const selected = this.episodes[this.episodePanelIndex];
    if (!selected?.id) {
      return;
    }
    this.switchingEpisode = true;
    try {
      const itemType = this.params?.itemType || "series";
      const streamResult = await streamRepository.getStreamsFromAllAddons(normalizeItemType(itemType), selected.id);
      const streamItems = (streamResult?.status === "success")
        ? flattenStreamGroups(streamResult)
        : [];
      if (!streamItems.length) {
        return;
      }
      const bestStream = this.selectBestStreamUrl(streamItems) || streamItems[0].url;
      const nextEpisode = this.episodes[this.episodePanelIndex + 1] || null;
      Router.navigate("player", {
        streamUrl: bestStream,
        itemId: this.params?.itemId,
        itemType,
        videoId: selected.id,
        season: selected.season ?? null,
        episode: selected.episode ?? null,
        episodeLabel: `S${selected.season}E${selected.episode}`,
        playerTitle: this.params?.playerTitle || this.params?.itemId,
        playerSubtitle: `${selected.title || ""}`.trim() || `S${selected.season}E${selected.episode}`,
        playerBackdropUrl: this.params?.playerBackdropUrl || null,
        playerLogoUrl: this.params?.playerLogoUrl || null,
        episodes: this.episodes,
        streamCandidates: streamItems,
        nextEpisodeVideoId: nextEpisode?.id || null,
        nextEpisodeLabel: nextEpisode ? `S${nextEpisode.season}E${nextEpisode.episode}` : null
      });
    } finally {
      this.switchingEpisode = false;
    }
  },

  async loadSubtitles() {
    const requestToken = (this.subtitleLoadToken || 0) + 1;
    this.subtitleLoadToken = requestToken;
    this.subtitleLoading = true;

    const sidecarSubtitles = this.collectStreamSidecarSubtitles();
    const subtitleLookup = this.buildSubtitleLookupContext();
    try {
      this.subtitles = this.mergeSubtitleCandidates(sidecarSubtitles, []);
      this.attachExternalSubtitles();
      this.refreshTrackDialogs();

      let repositorySubtitles = [];

      try {
        if (subtitleLookup.id && subtitleLookup.type) {
          repositorySubtitles = await subtitleRepository.getSubtitles(
            subtitleLookup.type,
            subtitleLookup.id,
            subtitleLookup.videoId || null
          );
        }
      } catch (error) {
        console.error("Subtitle fetch failed", error);
      }

      if (requestToken !== this.subtitleLoadToken) {
        return;
      }

      this.subtitles = this.mergeSubtitleCandidates(sidecarSubtitles, repositorySubtitles);
      this.attachExternalSubtitles();
      if (this.subtitleDialogVisible && this.subtitleDialogTab === "builtIn") {
        const builtInBoundary = this.resolveBuiltInSubtitleBoundary(this.getTextTracks());
        if (builtInBoundary <= 0 && this.subtitles.length > 0) {
          this.subtitleDialogTab = "addons";
          this.subtitleDialogIndex = 0;
        }
      }
      this.refreshTrackDialogs();
    } catch (error) {
      console.error("Subtitle attach failed", error);
      this.subtitles = this.mergeSubtitleCandidates(sidecarSubtitles, []);
      this.refreshTrackDialogs();
    } finally {
      if (requestToken === this.subtitleLoadToken) {
        this.subtitleLoading = false;
        this.refreshTrackDialogs();
      }
    }
  },

  attachExternalSubtitles() {
    const video = PlayerController.video;
    if (!video) {
      return;
    }

    this.externalTrackNodes.forEach((node) => node.remove());
    this.externalTrackNodes = [];

    this.builtInSubtitleCount = this.getTextTracks().length;

    this.subtitles.slice(0, 16).forEach((subtitle, index) => {
      if (!subtitle.url) {
        return;
      }
      const track = document.createElement("track");
      track.kind = "subtitles";
      track.label = subtitle.lang || `Sub ${index + 1}`;
      track.srclang = (subtitle.lang || "und").slice(0, 2).toLowerCase();
      track.src = subtitle.url;
      video.appendChild(track);
      this.externalTrackNodes.push(track);
    });
  },
  moveControlFocus(delta) {
    const controls = Array.from(this.container.querySelectorAll(".player-control-btn"));
    if (!controls.length) {
      return;
    }
    const current = this.container.querySelector(".player-control-btn.focused") || controls[0];
    let index = controls.indexOf(current);
    if (index < 0) {
      index = 0;
    }
    const nextIndex = clamp(index + delta, 0, controls.length - 1);
    if (nextIndex === index) {
      return;
    }
    current.classList.remove("focused");
    controls[nextIndex].classList.add("focused");
    controls[nextIndex].focus();
    this.resetControlsAutoHide();
  },

  performFocusedControl() {
    const current = this.container.querySelector(".player-control-btn.focused");
    if (!current) {
      return;
    }
    this.performControlAction(current.dataset.action || "");
  },

  performControlAction(action) {
    if (action === "playPause") {
      this.togglePause();
      this.renderControlButtons();
      return;
    }

    if (action === "subtitleDialog") {
      if (this.subtitleDialogVisible) {
        this.closeSubtitleDialog();
      } else {
        this.openSubtitleDialog();
      }
      return;
    }

    if (action === "audioTrack") {
      if (this.audioDialogVisible) {
        this.closeAudioDialog();
      } else {
        this.openAudioDialog();
      }
      return;
    }

    if (action === "source") {
      if (this.sourcesPanelVisible) {
        this.closeSourcesPanel();
      } else {
        this.openSourcesPanel();
      }
      return;
    }

    if (action === "episodes") {
      this.toggleEpisodePanel();
      return;
    }

    if (action === "more") {
      this.moreActionsVisible = true;
      this.renderControlButtons();
      this.focusFirstControl();
      return;
    }

    if (action === "backFromMore") {
      this.moreActionsVisible = false;
      this.renderControlButtons();
      this.focusFirstControl();
      return;
    }

    if (action === "aspect") {
      this.cycleAspectMode();
      return;
    }
  },

  consumeBackRequest() {
    if (this.seekOverlayVisible || this.seekPreviewSeconds != null) {
      this.cancelSeekPreview({ commit: false });
      return true;
    }

    if (this.sourcesPanelVisible) {
      this.closeSourcesPanel();
      return true;
    }

    if (this.subtitleDialogVisible) {
      this.closeSubtitleDialog();
      return true;
    }

    if (this.audioDialogVisible) {
      this.closeAudioDialog();
      return true;
    }

    if (this.episodePanelVisible) {
      this.hideEpisodePanel();
      return true;
    }

    if (this.moreActionsVisible) {
      this.moreActionsVisible = false;
      this.renderControlButtons();
      this.focusFirstControl();
      return true;
    }

    return false;
  },

  async onKeyDown(event) {
    const keyCode = Number(event?.keyCode || 0);
    if (keyCode === 37 || keyCode === 38 || keyCode === 39 || keyCode === 40 || keyCode === 13) {
      event?.preventDefault?.();
    }

    if (this.sourcesPanelVisible) {
      if (await this.handleSourcesPanelKey(event)) {
        return;
      }
    }

    if (this.subtitleDialogVisible) {
      if (this.handleSubtitleDialogKey(event)) {
        return;
      }
    }

    if (this.audioDialogVisible) {
      if (this.handleAudioDialogKey(event)) {
        return;
      }
    }

    if (keyCode === 83) {
      if (this.subtitleDialogVisible) {
        this.closeSubtitleDialog();
      } else {
        this.openSubtitleDialog();
      }
      return;
    }

    if (keyCode === 84) {
      if (this.audioDialogVisible) {
        this.closeAudioDialog();
      } else {
        this.openAudioDialog();
      }
      return;
    }

    if (keyCode === 67) {
      if (this.sourcesPanelVisible) {
        this.closeSourcesPanel();
      } else {
        this.openSourcesPanel();
      }
      return;
    }

    if (keyCode === 69) {
      this.toggleEpisodePanel();
      return;
    }

    if (keyCode === 80) {
      this.togglePause();
      this.renderControlButtons();
      return;
    }

    if (this.episodePanelVisible) {
      if (keyCode === 38) {
        this.moveEpisodePanel(-1);
        return;
      }
      if (keyCode === 40) {
        this.moveEpisodePanel(1);
        return;
      }
      if (keyCode === 13) {
        this.playEpisodeFromPanel();
        return;
      }
    }

    if (!this.controlsVisible) {
      if (keyCode === 37) {
        this.beginSeekPreview(-1, Boolean(event?.repeat));
        return;
      }
      if (keyCode === 39) {
        this.beginSeekPreview(1, Boolean(event?.repeat));
        return;
      }
      if (keyCode === 38 || keyCode === 40 || keyCode === 13) {
        this.cancelSeekPreview({ commit: true });
        this.setControlsVisible(true, { focus: keyCode === 13 });
        if (keyCode === 13) {
          this.togglePause();
          this.renderControlButtons();
        }
      }
      return;
    }

    if (keyCode === 37) {
      this.moveControlFocus(-1);
      return;
    }
    if (keyCode === 39) {
      this.moveControlFocus(1);
      return;
    }
    if (keyCode === 40) {
      this.setControlsVisible(false);
      return;
    }
    if (keyCode === 13) {
      this.performFocusedControl();
      return;
    }

    this.resetControlsAutoHide();
  },

  selectBestStreamUrl(streams = []) {
    if (!Array.isArray(streams) || !streams.length) {
      return null;
    }

    const scored = streams
      .filter((stream) => Boolean(stream?.url))
      .map((stream) => {
        const text = `${stream.title || stream.label || ""} ${stream.name || ""}`.toLowerCase();
        let score = 0;
        if (text.includes("1080")) score += 30;
        if (text.includes("2160") || text.includes("4k")) score += 20;
        if (text.includes("web")) score += 8;
        if (text.includes("bluray")) score += 8;
        if (text.includes("cam")) score -= 40;
        if (text.includes("ts")) score -= 20;
        return { stream, score };
      })
      .sort((left, right) => right.score - left.score);

    return scored[0]?.stream?.url || streams[0]?.url || null;
  },

  async handlePlaybackEnded() {
    let nextVideoId = this.params?.nextEpisodeVideoId || null;
    let nextEpisodeLabel = this.params?.nextEpisodeLabel || null;
    let nextEpisode = null;
    if (!nextVideoId && this.params?.videoId && this.episodes.length) {
      const currentIndex = this.episodes.findIndex((episode) => episode.id === this.params.videoId);
      nextEpisode = currentIndex >= 0 ? this.episodes[currentIndex + 1] : null;
      nextVideoId = nextEpisode?.id || null;
      nextEpisodeLabel = nextEpisode ? `S${nextEpisode.season}E${nextEpisode.episode}` : null;
    }
    if (!nextEpisode && nextVideoId && this.episodes.length) {
      nextEpisode = this.episodes.find((episode) => episode.id === nextVideoId) || null;
    }
    const itemType = normalizeItemType(this.params?.itemType || "movie");
    if (!nextVideoId || itemType !== "series") {
      return;
    }

    try {
      const streamResult = await streamRepository.getStreamsFromAllAddons(itemType, nextVideoId);
      const streamItems = (streamResult?.status === "success")
        ? flattenStreamGroups(streamResult)
        : [];
      if (!streamItems.length) {
        return;
      }
      const bestStream = this.selectBestStreamUrl(streamItems) || streamItems[0].url;
      Router.navigate("player", {
        streamUrl: bestStream,
        itemId: this.params?.itemId,
        itemType,
        videoId: nextVideoId,
        season: nextEpisode?.season ?? null,
        episode: nextEpisode?.episode ?? null,
        episodeLabel: nextEpisodeLabel || null,
        playerTitle: this.params?.playerTitle || this.params?.itemId,
        playerSubtitle: nextEpisodeLabel || "",
        playerBackdropUrl: this.params?.playerBackdropUrl || null,
        playerLogoUrl: this.params?.playerLogoUrl || null,
        episodes: this.episodes || [],
        streamCandidates: streamItems,
        nextEpisodeVideoId: null,
        nextEpisodeLabel: null
      });
    } catch (error) {
      console.warn("Next episode auto-play failed", error);
    }
  },

  cleanup() {
    this.cancelSeekPreview({ commit: false });
    this.subtitleLoadToken = (this.subtitleLoadToken || 0) + 1;
    this.manifestLoadToken = (this.manifestLoadToken || 0) + 1;
    this.trackDiscoveryToken = (this.trackDiscoveryToken || 0) + 1;
    this.trackDiscoveryInProgress = false;
    this.trackDiscoveryStartedAt = 0;
    this.trackDiscoveryDeadline = 0;
    this.subtitleLoading = false;
    this.manifestLoading = false;
    this.clearTrackDiscoveryTimer();

    this.externalTrackNodes.forEach((node) => node.remove());
    this.externalTrackNodes = [];

    this.clearControlsAutoHide();

    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    if (this.aspectToastTimer) {
      clearTimeout(this.aspectToastTimer);
      this.aspectToastTimer = null;
    }

    if (this.parentalGuideTimer) {
      clearTimeout(this.parentalGuideTimer);
      this.parentalGuideTimer = null;
    }

    if (this.subtitleSelectionTimer) {
      clearTimeout(this.subtitleSelectionTimer);
      this.subtitleSelectionTimer = null;
    }

    this.unbindVideoEvents();

    PlayerController.stop();

    if (this.container) {
      this.container.style.display = "none";
      this.container.querySelector("#playerUiRoot")?.remove();
      this.container.querySelector("#episodeSidePanel")?.remove();
    }

    if (this.endedHandler && PlayerController.video) {
      PlayerController.video.removeEventListener("ended", this.endedHandler);
      this.endedHandler = null;
    }
  }

};
