import { PlayerController } from "../../../core/player/playerController.js";
import { SubtitleDialog } from "./subtitleDialog.js";
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

export const PlayerScreen = {

  async mount(params = {}) {
    this.container = document.getElementById("player");
    this.container.style.display = "block";
    this.params = params;
    this.streamCandidates = Array.isArray(params.streamCandidates) ? params.streamCandidates : [];
    const initialStreamUrl = params.streamUrl || this.selectBestStreamUrl(this.streamCandidates) || null;
    this.currentStreamIndex = this.streamCandidates.findIndex((stream) => stream.url === initialStreamUrl);
    if (this.currentStreamIndex < 0) {
      this.currentStreamIndex = 0;
    }

    this.subtitles = [];
    this.subtitleDialogVisible = false;
    this.selectedSubtitleTrackIndex = -1;
    this.selectedAudioTrackIndex = -1;
    this.externalTrackNodes = [];
    this.episodes = Array.isArray(params.episodes) ? params.episodes : [];
    this.episodePanelVisible = false;
    this.episodePanelIndex = Math.max(0, this.episodes.findIndex((entry) => entry.id === params.videoId));
    this.switchingEpisode = false;
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
    this.updateUiTick();

    if (initialStreamUrl) {
      PlayerController.play(initialStreamUrl, {
        itemId: params.itemId || null,
        itemType: params.itemType || "movie",
        videoId: params.videoId || null,
        season: params.season == null ? null : Number(params.season),
        episode: params.episode == null ? null : Number(params.episode)
      });
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
          <div class="player-loading-title">${this.params.playerTitle || this.params.itemId || "Nuvio"}</div>
          ${this.params.playerSubtitle ? `<div class="player-loading-subtitle">${this.params.playerSubtitle}</div>` : ""}
        </div>
      </div>

      <div id="playerControlsOverlay" class="player-controls-overlay">
        <div class="player-controls-top">
          <div id="playerClock" class="player-clock">--:--</div>
          <div class="player-ends-at">Ends at: <span id="playerEndsAt">--:--</span></div>
        </div>

        <div class="player-controls-bottom">
          <div class="player-meta">
            <div class="player-title">${this.params.playerTitle || this.params.itemId || "Untitled"}</div>
            <div class="player-subtitle">${this.params.playerSubtitle || this.params.episodeLabel || this.params.itemType || ""}</div>
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
  },

  bindVideoEvents() {
    const video = PlayerController.video;
    if (!video) {
      return;
    }

    const onWaiting = () => {
      this.loadingVisible = true;
      this.updateLoadingVisibility();
      this.setControlsVisible(true, { focus: false });
    };

    const onPlaying = () => {
      this.loadingVisible = false;
      this.paused = false;
      this.updateLoadingVisibility();
      this.updateUiTick();
      this.resetControlsAutoHide();
    };

    const onPause = () => {
      if (video.ended) {
        return;
      }
      this.paused = true;
      this.setControlsVisible(true, { focus: false });
      this.updateUiTick();
    };

    const onTimeUpdate = () => {
      this.updateUiTick();
    };

    const onLoadedMetadata = () => {
      this.updateUiTick();
    };

    const bindings = [
      ["waiting", onWaiting],
      ["playing", onPlaying],
      ["pause", onPause],
      ["timeupdate", onTimeUpdate],
      ["loadedmetadata", onLoadedMetadata]
    ];

    bindings.forEach(([eventName, handler]) => {
      video.addEventListener(eventName, handler);
      this.videoListeners.push({ eventName, handler });
    });
  },

  unbindVideoEvents() {
    const video = PlayerController.video;
    if (!video) {
      return;
    }
    this.videoListeners.forEach(({ eventName, handler }) => {
      video.removeEventListener(eventName, handler);
    });
    this.videoListeners = [];
  },

  getControlDefinitions() {
    const base = [
      { action: "playPause", label: this.paused ? ">" : "II", icon: this.paused ? "assets/icons/ic_player_play.svg" : "assets/icons/ic_player_pause.svg", title: "Play/Pause" },
      { action: "subtitleDialog", label: "CC", icon: "assets/icons/ic_player_subtitles.svg", title: "Subtitles" },
      { action: "audioTrack", label: "A", icon: this.selectedAudioTrackIndex >= 0 ? "assets/icons/ic_player_audio_filled.svg" : "assets/icons/ic_player_audio_outline.svg", title: "Audio" },
      { action: "source", label: "SRC", icon: "assets/icons/ic_player_source.svg", title: "Source" },
      { action: "episodes", label: "EP", icon: "assets/icons/ic_player_episodes.svg", title: "Episodes" },
      { action: "more", label: this.moreActionsVisible ? "<" : ">", title: "More" }
    ];
    if (!this.moreActionsVisible) {
      return base;
    }
    return [
      ...base.slice(0, 5),
      { action: "aspect", label: "AR", icon: "assets/icons/ic_player_aspect_ratio.svg", title: "Aspect Ratio" },
      { action: "external", label: "EXT", title: "External Player" },
      { action: "backFromMore", label: "<", title: "Back" }
    ];
  },

  renderControlButtons() {
    const wrap = this.container.querySelector("#playerControlButtons");
    if (!wrap) {
      return;
    }
    const currentAction = this.container.querySelector(".player-control-btn.focused")?.dataset?.action || "";
    const controls = this.getControlDefinitions();
    wrap.innerHTML = controls.map((control) => `
      <button class="player-control-btn focusable"
              data-action="${control.action}"
              title="${control.title}">
        ${control.icon ? `<img class="player-control-icon" src="${control.icon}" alt="" aria-hidden="true" />` : control.label}
      </button>
    `).join("");

    const preferred = wrap.querySelector(`.player-control-btn[data-action="${currentAction}"]`)
      || wrap.querySelector(".player-control-btn");
    if (preferred) {
      preferred.classList.add("focused");
    }
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
    const btn = this.container.querySelector(".player-control-btn");
    if (!btn) {
      return;
    }
    this.container.querySelectorAll(".player-control-btn").forEach((node) => node.classList.remove("focused"));
    btn.classList.add("focused");
    btn.focus();
  },

  clearControlsAutoHide() {
    if (this.controlsHideTimer) {
      clearTimeout(this.controlsHideTimer);
      this.controlsHideTimer = null;
    }
  },

  resetControlsAutoHide() {
    this.clearControlsAutoHide();
    if (!this.controlsVisible || this.paused || this.subtitleDialogVisible || this.episodePanelVisible) {
      return;
    }
    this.controlsHideTimer = setTimeout(() => {
      this.setControlsVisible(false);
    }, 4500);
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
    const progress = duration > 0 ? Math.max(0, Math.min(1, current / duration)) : 0;

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
  },

  seekBy(seconds) {
    const video = PlayerController.video;
    if (!video || Number.isNaN(video.currentTime)) {
      return;
    }
    const duration = Number(video.duration || 0);
    let nextTime = Math.max(0, (video.currentTime || 0) + seconds);
    if (duration > 0) {
      nextTime = Math.min(duration, nextTime);
    }
    video.currentTime = nextTime;
    this.setControlsVisible(true, { focus: false });
    this.updateUiTick();
    this.resetControlsAutoHide();
  },

  togglePause() {
    if (this.paused) {
      PlayerController.resume();
      this.paused = false;
      this.setControlsVisible(true, { focus: false });
      return;
    }

    PlayerController.pause();
    this.paused = true;
    this.setControlsVisible(true, { focus: true });
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

    this.loadingVisible = true;
    this.updateLoadingVisibility();
    PlayerController.play(selected.url, {
      itemId: this.params.itemId || null,
      itemType: this.params.itemType || "movie",
      videoId: this.params.videoId || null,
      season: this.params.season == null ? null : Number(this.params.season),
      episode: this.params.episode == null ? null : Number(this.params.episode)
    });
    this.paused = false;
    this.syncTrackState();
    this.updateUiTick();
    this.setControlsVisible(true, { focus: false });
  },

  toggleSubtitleDialog() {
    this.syncTrackState();
    if (this.subtitleDialogVisible) {
      SubtitleDialog.hide(this.container);
      this.subtitleDialogVisible = false;
      this.resetControlsAutoHide();
      return;
    }

    this.setControlsVisible(true, { focus: false });
    SubtitleDialog.show(this.container, this.buildSubtitleDialogEntries());
    this.subtitleDialogVisible = true;
  },

  buildSubtitleDialogEntries() {
    const list = [];

    list.push({
      label: "OFF",
      source: "player",
      active: this.selectedSubtitleTrackIndex < 0
    });

    this.getTextTracks().forEach((track, index) => {
      list.push({
        label: track.label || track.language || `Track ${index + 1}`,
        source: "textTrack",
        active: index === this.selectedSubtitleTrackIndex
      });
    });

    if (!this.getTextTracks().length && this.subtitles.length) {
      this.subtitles.forEach((subtitle, index) => {
        list.push({
          label: subtitle.lang || `Subtitle ${index + 1}`,
          source: subtitle.addonName || "addon",
          active: false
        });
      });
    }

    return list;
  },

  getTextTracks() {
    const video = PlayerController.video;
    if (!video || !video.textTracks) {
      return [];
    }
    return Array.from(video.textTracks);
  },

  getAudioTracks() {
    const video = PlayerController.video;
    if (!video || !video.audioTracks) {
      return [];
    }
    return Array.from(video.audioTracks);
  },

  syncTrackState() {
    const textTracks = this.getTextTracks();
    const audioTracks = this.getAudioTracks();

    this.selectedSubtitleTrackIndex = textTracks.findIndex((track) => track.mode === "showing");
    this.selectedAudioTrackIndex = audioTracks.findIndex((track) => track.enabled);
  },

  cycleSubtitleTrack() {
    const textTracks = this.getTextTracks();
    if (!textTracks.length) {
      return;
    }

    this.syncTrackState();
    const next = this.selectedSubtitleTrackIndex + 1;
    const normalized = next > textTracks.length - 1 ? -1 : next;

    textTracks.forEach((track, index) => {
      track.mode = index === normalized ? "showing" : "disabled";
    });

    this.selectedSubtitleTrackIndex = normalized;
    if (this.subtitleDialogVisible) {
      SubtitleDialog.show(this.container, this.buildSubtitleDialogEntries());
    }
  },

  cycleAudioTrack() {
    const audioTracks = this.getAudioTracks();
    if (!audioTracks.length) {
      return;
    }

    this.syncTrackState();
    let nextIndex = this.selectedAudioTrackIndex + 1;
    if (nextIndex > audioTracks.length - 1) {
      nextIndex = 0;
    }

    audioTracks.forEach((track, index) => {
      track.enabled = index === nextIndex;
    });

    this.selectedAudioTrackIndex = nextIndex;
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
    this.setControlsVisible(true, { focus: false });
    this.renderEpisodePanel();
  },

  moveEpisodePanel(delta) {
    if (!this.episodePanelVisible || !this.episodes.length) {
      return;
    }
    const lastIndex = this.episodes.length - 1;
    this.episodePanelIndex = Math.min(lastIndex, Math.max(0, this.episodePanelIndex + delta));
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
          <div class="player-episode-item-title">S${episode.season}E${episode.episode} ${episode.title || "Episode"}</div>
          <div class="player-episode-item-subtitle">${episode.overview || ""}</div>
        </div>
      `;
    }).join("");

    panel.innerHTML = `
      <div class="player-episode-panel-title">Episodes</div>
      <div class="player-episode-panel-hint">UP/DOWN select, OK play, E close</div>
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
      const streamResult = await streamRepository.getStreamsFromAllAddons(itemType, selected.id);
      const streamItems = (streamResult?.status === "success")
        ? (streamResult.data || []).flatMap((group) =>
          (group.streams || []).map((stream) => ({
            ...stream,
            addonName: group.addonName || stream.addonName || "Addon"
          }))
        ).filter((stream) => Boolean(stream.url))
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
    if (!this.params.itemId || !this.params.itemType) {
      return;
    }
    try {
      this.subtitles = await subtitleRepository.getSubtitles(
        this.params.itemType,
        this.params.itemId
      );
      this.attachExternalSubtitles();
      this.syncTrackState();
    } catch (error) {
      console.error("Subtitle fetch failed", error);
      this.subtitles = [];
    }
  },

  attachExternalSubtitles() {
    const video = PlayerController.video;
    if (!video) {
      return;
    }

    this.externalTrackNodes.forEach((node) => node.remove());
    this.externalTrackNodes = [];

    this.subtitles.slice(0, 10).forEach((subtitle, index) => {
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
    const nextIndex = Math.min(controls.length - 1, Math.max(0, index + delta));
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
      this.toggleSubtitleDialog();
      return;
    }
    if (action === "audioTrack") {
      this.cycleAudioTrack();
      return;
    }
    if (action === "source") {
      this.switchStream(1);
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
      return;
    }
    if (action === "external") {
      return;
    }
  },

  onKeyDown(event) {
    const keyCode = Number(event?.keyCode || 0);

    if (keyCode === 83) {
      this.toggleSubtitleDialog();
      return;
    }
    if (keyCode === 86) {
      this.cycleSubtitleTrack();
      return;
    }
    if (keyCode === 84) {
      this.cycleAudioTrack();
      return;
    }
    if (keyCode === 67) {
      this.switchStream(1);
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
        this.seekBy(-10);
        return;
      }
      if (keyCode === 39) {
        this.seekBy(10);
        return;
      }
      if (keyCode === 38 || keyCode === 40 || keyCode === 13) {
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
        const text = `${stream.title || ""} ${stream.name || ""}`.toLowerCase();
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
    const itemType = this.params?.itemType || "movie";
    if (!nextVideoId || (itemType !== "series" && itemType !== "tv")) {
      return;
    }

    try {
      const streamResult = await streamRepository.getStreamsFromAllAddons(itemType, nextVideoId);
      const streamItems = (streamResult?.status === "success")
        ? (streamResult.data || []).flatMap((group) =>
          (group.streams || []).map((stream) => ({
            ...stream,
            addonName: group.addonName || stream.addonName || "Addon"
          }))
        ).filter((stream) => Boolean(stream.url))
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
    SubtitleDialog.hide(this.container);
    this.externalTrackNodes.forEach((node) => node.remove());
    this.externalTrackNodes = [];
    this.clearControlsAutoHide();

    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
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
