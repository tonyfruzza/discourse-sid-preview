import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { action } from "@ember/object";
import { service } from "@ember/service";
import { on } from "@ember/modifier";
import icon from "discourse-common/helpers/d-icon";
import I18n from "discourse-i18n";
import SIDPlayer from "../lib/sid-player-engine";

function eq(a, b) {
  return a === b;
}

export default class SidPlayerComponent extends Component {
  @service siteSettings;

  @tracked state = "idle"; // idle | loading | ready | playing | paused | error | ended
  @tracked title = "";
  @tracked author = "";
  @tracked info = "";
  @tracked subtunes = 1;
  @tracked currentSubtune = 0;
  @tracked playtime = 0;
  @tracked errorMessage = "";

  _player = null;
  _timerInterval = null;

  get maxSeconds() {
    return this.siteSettings.sid_preview_max_seconds || 60;
  }

  get defaultModel() {
    return parseInt(this.siteSettings.sid_preview_default_model || "6581", 10);
  }

  get formattedTime() {
    const mins = Math.floor(this.playtime / 60);
    const secs = this.playtime % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  get formattedMaxTime() {
    const mins = Math.floor(this.maxSeconds / 60);
    const secs = this.maxSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  get fileName() {
    if (this.args.filename) return this.args.filename;
    if (!this.args.url) return "";
    try {
      const url = new URL(this.args.url, window.location.origin);
      const parts = url.pathname.split("/");
      return decodeURIComponent(parts[parts.length - 1]);
    } catch {
      return this.args.url;
    }
  }

  get showPlayButton() {
    return (
      this.state === "ready" ||
      this.state === "paused" ||
      this.state === "ended"
    );
  }

  get showPauseButton() {
    return this.state === "playing";
  }

  get showStopButton() {
    return this.state === "playing" || this.state === "paused";
  }

  get hasMetadata() {
    return this.title || this.author;
  }

  get hasMultipleSubtunes() {
    return this.subtunes > 1;
  }

  get subtuneOptions() {
    const options = [];
    for (let i = 0; i < this.subtunes; i++) {
      options.push(i);
    }
    return options;
  }

  _ensurePlayer() {
    if (!this._player) {
      this._player = new SIDPlayer(16384, 0.0005);
      this._player.onLoad = (metadata) => {
        this.title = metadata.title.trim();
        this.author = metadata.author.trim();
        this.info = metadata.info.trim();
        this.subtunes = metadata.subtunes;
        this.state = "ready";
        this._player.setModel(this.defaultModel);
      };
    }
    return this._player;
  }

  _startTimer() {
    this._stopTimer();
    this._timerInterval = setInterval(() => {
      if (this._player) {
        this.playtime = this._player.getPlaytime();
        if (this.playtime >= this.maxSeconds) {
          this._player.pause();
          this._stopTimer();
          this.state = "ended";
        }
      }
    }, 250);
  }

  _stopTimer() {
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
  }

  @action
  async loadAndPlay() {
    const player = this._ensurePlayer();
    this.state = "loading";
    this.playtime = 0;

    try {
      await player.load(this.args.url, 0);
      this.currentSubtune = 0;
      player.play();
      this.state = "playing";
      this._startTimer();
    } catch (e) {
      this.state = "error";
      this.errorMessage = e.message || I18n.t("sid_player.error");
    }
  }

  @action
  play() {
    if (!this._player) {
      this.loadAndPlay();
      return;
    }
    this._player.play();
    this.state = "playing";
    this._startTimer();
  }

  @action
  pause() {
    if (this._player) {
      this._player.pause();
      this._stopTimer();
      this.state = "paused";
    }
  }

  @action
  stop() {
    if (this._player) {
      this._player.stop();
      this._stopTimer();
      this.playtime = 0;
      this.state = "ready";
    }
  }

  @action
  restart() {
    if (this._player) {
      this._player.restart();
      this.playtime = 0;
      this.state = "playing";
      this._startTimer();
    }
  }

  @action
  changeSubtune(event) {
    if (this._player) {
      const wasPlaying = this.state === "playing";
      this.currentSubtune = parseInt(event.target.value, 10);
      this._player.setSubtune(this.currentSubtune);
      this.playtime = 0;
      if (wasPlaying) {
        this._player.play();
        this.state = "playing";
        this._startTimer();
      } else {
        this.state = "ready";
      }
    }
  }

  willDestroy() {
    super.willDestroy(...arguments);
    this._stopTimer();
    if (this._player) {
      this._player.destroy();
      this._player = null;
    }
  }

  <template>
    <div class="sid-player" data-sid-url={{@url}}>
      <div class="sid-player__header">
        <span class="sid-player__icon">♪</span>
        <span class="sid-player__filename">{{this.fileName}}</span>
        <a href={{@url}} class="sid-player__download" title="Download" download>
          {{icon "download"}}
        </a>
      </div>

      {{#if this.hasMetadata}}
        <div class="sid-player__meta">
          {{#if this.title}}
            <div class="sid-player__meta-row">
              <span class="sid-player__label">Title:</span>
              <span class="sid-player__value">{{this.title}}</span>
            </div>
          {{/if}}
          {{#if this.author}}
            <div class="sid-player__meta-row">
              <span class="sid-player__label">Author:</span>
              <span class="sid-player__value">{{this.author}}</span>
            </div>
          {{/if}}
        </div>
      {{/if}}

      <div class="sid-player__controls">
        {{#if (eq this.state "idle")}}
          <button
            class="btn btn-primary sid-player__btn"
            type="button"
            {{on "click" this.loadAndPlay}}
          >
            {{icon "play"}} Load &amp; Play
          </button>
        {{else if (eq this.state "loading")}}
          <span class="sid-player__loading">
            {{icon "spinner"}} Loading...
          </span>
        {{else if (eq this.state "error")}}
          <span class="sid-player__error">
            {{icon "exclamation-triangle"}} {{this.errorMessage}}
          </span>
        {{else}}
          {{#if this.showPlayButton}}
            <button
              class="btn btn-icon sid-player__btn"
              type="button"
              title="Play"
              {{on "click" this.play}}
            >
              {{icon "play"}}
            </button>
          {{/if}}

          {{#if this.showPauseButton}}
            <button
              class="btn btn-icon sid-player__btn"
              type="button"
              title="Pause"
              {{on "click" this.pause}}
            >
              {{icon "pause"}}
            </button>
          {{/if}}

          {{#if this.showStopButton}}
            <button
              class="btn btn-icon sid-player__btn"
              type="button"
              title="Stop"
              {{on "click" this.stop}}
            >
              {{icon "far-stop-circle"}}
            </button>

            <button
              class="btn btn-icon sid-player__btn"
              type="button"
              title="Restart"
              {{on "click" this.restart}}
            >
              {{icon "redo"}}
            </button>
          {{/if}}

          <span class="sid-player__time">
            {{this.formattedTime}} / {{this.formattedMaxTime}}
          </span>

          {{#if this.hasMultipleSubtunes}}
            <span class="sid-player__subtune">
              <label class="sid-player__subtune-label">Tune:</label>
              <select
                class="sid-player__subtune-select"
                {{on "change" this.changeSubtune}}
              >
                {{#each this.subtuneOptions as |idx|}}
                  <option
                    value={{idx}}
                    selected={{eq idx this.currentSubtune}}
                  >
                    {{idx}}
                  </option>
                {{/each}}
              </select>
            </span>
          {{/if}}

          {{#if (eq this.state "ended")}}
            <span class="sid-player__ended">
              ⏱ Limit reached
            </span>
          {{/if}}
        {{/if}}
      </div>

      <div class="sid-player__progress">
        <div
          class="sid-player__progress-bar"
          style="width: {{this.progressPercent}}%"
        ></div>
      </div>
    </div>
  </template>

  get progressPercent() {
    if (this.maxSeconds <= 0) return 0;
    return Math.min(100, (this.playtime / this.maxSeconds) * 100);
  }
}
