/**
 * SIDPlayer - websidplayfp (libsidplayfp / reSIDfp) WASM engine for Discourse
 *
 * Audio engine : websidplayfp by Juergen Wothke
 *   https://bitbucket.org/wothke/websidplayfp/   (GPL-2.0)
 * Player framework : ScriptNodePlayer by Juergen Wothke
 *   https://bitbucket.org/wothke/websidplayfp/   (CC BY-NC-SA 4.0)
 * WASM + JS adapter sourced from the DeepSID project
 *   https://github.com/Chordian/deepsid
 *
 * This module dynamically loads three static files served from /sid-player/:
 *   scriptprocessor_player.min.js   — generic WebAudio player framework
 *   websidplay-backend.js           — Emscripten glue + SIDPlayBackendAdapter
 *   websidplay.wasm                 — libsidplayfp compiled to WebAssembly
 *
 * Public API matches the previous jsSID-based SIDPlayer so that sid-player.gjs
 * requires zero changes.
 */

// Path where the three static vendor files are served as Discourse public assets.
const SID_PLAYER_PATH = "/sid-player/";

// ── Vendor script loader ─────────────────────────────────────────────────────

let _vendorPromise = null;

function _loadVendorScripts() {
  if (_vendorPromise) return _vendorPromise;

  // Tell the Emscripten module where to find websidplay.wasm BEFORE the backend
  // script executes — locateFile checks window.WASM_SEARCH_PATH at call time.
  window.WASM_SEARCH_PATH = SID_PLAYER_PATH;

  const loadScript = (src) =>
    new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        // Already injected by a previous player instance on this page.
        resolve();
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Failed to load: " + src));
      document.head.appendChild(s);
    });

  // Load the player framework first; the SID backend depends on its globals.
  _vendorPromise = loadScript(
    SID_PLAYER_PATH + "scriptprocessor_player.min.js"
  ).then(() => loadScript(SID_PLAYER_PATH + "websidplay-backend.js"));

  return _vendorPromise;
}

// ── ScriptNodePlayer singleton ───────────────────────────────────────────────

// ── ScriptNodePlayer instance management ─────────────────────────────────────

// Mutable object updated at the start of every load() call.
// Closures installed into ScriptNodePlayer at creation time read from here.
let _activeCallbacks = null;

/**
 * Create a fresh ScriptNodePlayer instance.
 *
 * DeepSID calls createInstance() before every loadMusicFromURL() — this tears
 * down the previous audio pipeline and builds a new one.  This avoids the
 * _fileReadyNotify cache problem (repeated loads of the same URL) and the
 * WASM abort(3) crash that occurs when re-loading into an already-initialised
 * backend.
 */
function _createPlayer() {
  return new Promise((resolve) => {
    const adapter = new window.SIDPlayBackendAdapter(
      undefined, // basicROM
      undefined, // charROM
      undefined  // kernalROM
    );
    // 16384 is the maximum ScriptProcessorNode allows — generous headroom
    // to survive GC pauses and main-thread contention.
    adapter.setProcessorBufSize(16384);

    window.ScriptNodePlayer.createInstance(
      adapter,
      null,  // basePath (unused)
      [],    // requiredFiles to preload
      false, // spectrumEnabled

      // onPlayerReady — fires once when the WASM runtime has fully initialised
      function onPlayerReady() {
        resolve();
      },

      // onTrackReadyToPlay — global handler; overridden per-call via 6th param
      function onTrackReadyToPlay() {},

      // onTrackEnd — fires when the song ends naturally / times out
      function onTrackEnd() {
        if (_activeCallbacks && _activeCallbacks.onTrackEnd) {
          _activeCallbacks.onTrackEnd();
        }
      }
    );
  });
}

// ── SIDPlayer public class ───────────────────────────────────────────────────

export default class SIDPlayer {
  /**
   * @param {number} _bufferLength    — ignored (kept for API compatibility)
   * @param {number} _backgroundNoise — ignored
   */
  constructor(_bufferLength, _backgroundNoise) {
    this._url = null;
    this._subtune = 0;
    this._isPlaying = false;
    this._loaded = false;
    this._metadata = null;

    this._onLoad = null;
    this._onStart = null;
    this._onEnd = null;
    this._onTimeUpdate = null;

    this._timeUpdateId = null;
  }

  // ── Loading ──────────────────────────────────────────────────────────────

  /**
   * Fetch and prepare a SID file for playback.
   *
   * Creates a fresh ScriptNodePlayer instance for every load — this matches
   * DeepSID's approach and avoids the _fileReadyNotify cache bug and WASM
   * abort(3) that occur when reusing a stale instance.
   */
  load(url, subtune = 0) {
    this._url = url;
    this._subtune = subtune;
    this._loaded = false;

    const self = this;

    return _loadVendorScripts()
      .then(() => _createPlayer())
      .then(
        () =>
          new Promise((resolve, reject) => {
            // Timeout guard — prevents hanging forever if callbacks never fire.
            const timeout = setTimeout(
              () => reject(new Error("SID load timed out")),
              15000
            );

            // Wire up the onTrackEnd callback for this load cycle.
            _activeCallbacks = {
              onTrackEnd() {
                self._isPlaying = false;
                self._stopTimeUpdates();
                if (self._onEnd) self._onEnd();
              },
            };

            const p = window.ScriptNodePlayer.getInstance();
            if (!p) {
              clearTimeout(timeout);
              reject(new Error("ScriptNodePlayer not ready"));
              return;
            }

            p.loadMusicFromURL(
              url,
              { track: subtune },
              () => {},  // onCompletion
              () => {    // onFail
                clearTimeout(timeout);
                reject(new Error("Failed to load SID: " + url));
              },
              () => {},  // onProgress
              () => {    // onTrackReadyToPlay (6th param — per-call override)
                clearTimeout(timeout);
                self._loaded = true;
                self._isPlaying = true;
                self._updateMetadata();
                if (self._onLoad) self._onLoad(self._metadata);
                if (self._onStart) self._onStart();
                self._startTimeUpdates();
                resolve();
              }
            );
          })
      );
  }

  /** Convenience alias — ScriptNodePlayer auto-plays, so this equals load(). */
  loadAndPlay(url, subtune = 0) {
    return this.load(url, subtune);
  }

  // ── Transport ────────────────────────────────────────────────────────────

  play() {
    if (!this._loaded) return;

    const p = window.ScriptNodePlayer && window.ScriptNodePlayer.getInstance();
    if (!p) return;

    // Resume a suspended AudioContext (e.g. after a tab switch on Chrome).
    if (
      window._gPlayerAudioCtx &&
      window._gPlayerAudioCtx.state === "suspended"
    ) {
      window._gPlayerAudioCtx.resume();
    }

    p.resume();
    this._isPlaying = true;
    this._startTimeUpdates();
    if (this._onStart) this._onStart();
  }

  pause() {
    if (!this._isPlaying) return;

    const p = window.ScriptNodePlayer && window.ScriptNodePlayer.getInstance();
    if (!p) return;

    p.pause();
    this._isPlaying = false;
    this._stopTimeUpdates();
  }

  /**
   * Stop playback and seek back to position 0 so that the next play() resumes
   * from the beginning — matches the behaviour of the previous jsSID version.
   */
  stop() {
    this.pause();
    if (!this._loaded) return;

    const p = window.ScriptNodePlayer && window.ScriptNodePlayer.getInstance();
    if (p) {
      try {
        p.seekPlaybackPosition(0);
      } catch (_) {
        // Seek is not supported for every SID; silently ignore.
      }
    }
  }

  /**
   * Seek to position 0 and resume — synchronous, no network reload needed.
   */
  restart() {
    if (!this._loaded) return;

    const p = window.ScriptNodePlayer && window.ScriptNodePlayer.getInstance();
    if (p) {
      try {
        p.seekPlaybackPosition(0);
      } catch (_) {
        // ignore
      }
    }

    this._isPlaying = false; // play() will flip this back to true
    this.play();
  }

  /**
   * Switch to a different subtune in-place on the already-loaded SID file.
   *
   * This calls the WASM emu_set_subsong() function via the backend adapter's
   * evalTrackOptions(), avoiding the need to tear down and recreate the
   * ScriptNodePlayer (which triggers WASM abort(3)).
   *
   * Returns true on success, false on failure.
   */
  switchSubtune(index) {
    if (!this._loaded) return false;

    const p = window.ScriptNodePlayer && window.ScriptNodePlayer.getInstance();
    if (!p) return false;

    const adapter = p._backendAdapter;
    if (!adapter || typeof adapter.evalTrackOptions !== "function") return false;

    const ret = adapter.evalTrackOptions({ track: index });
    if (ret !== 0) return false;

    this._subtune = index;

    // Seek back to position 0 so the new subtune starts from the beginning.
    try {
      p.seekPlaybackPosition(0);
    } catch (_) {
      // Seek is not supported for every SID; silently ignore.
    }

    return true;
  }

  // ── Configuration ────────────────────────────────────────────────────────

  /**
   * Select the SID chip model: 6581 (old, "warm") or 8580 (new, "clean").
   * Applies immediately; takes effect on the next audio buffer.
   */
  setModel(model) {
    const p = window.ScriptNodePlayer && window.ScriptNodePlayer.getInstance();
    if (!p) return;
    const adapter = p._backendAdapter;
    if (adapter && typeof adapter.setSID6581 === "function") {
      adapter.setSID6581(model === 6581);
    }
  }

  /** Set output volume in the range 0.0–1.0. */
  setVolume(vol) {
    const p = window.ScriptNodePlayer && window.ScriptNodePlayer.getInstance();
    if (p) p.setVolume(vol);
  }

  // ── Status / metadata ────────────────────────────────────────────────────

  /** Current playtime in seconds (float). */
  getPlaytime() {
    const p = window.ScriptNodePlayer && window.ScriptNodePlayer.getInstance();
    return p ? p.getCurrentPlaytime() : 0;
  }

  /** Returns the metadata object populated by the last successful load(). */
  getMetadata() {
    return this._metadata;
  }

  get isPlaying() {
    return this._isPlaying;
  }

  get isLoaded() {
    return this._loaded;
  }

  // ── Callback setters ─────────────────────────────────────────────────────

  /** Fired once the track is loaded and metadata is available. */
  set onLoad(fn) {
    this._onLoad = fn;
  }
  /** Fired when playback starts (including the automatic play after load). */
  set onStart(fn) {
    this._onStart = fn;
  }
  /** Fired when the song ends naturally. */
  set onEnd(fn) {
    this._onEnd = fn;
  }
  /** Fired ~4 times/sec with the current playtime in seconds. */
  set onTimeUpdate(fn) {
    this._onTimeUpdate = fn;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Release resources held by this instance.
   * The shared WASM engine and ScriptNodePlayer singleton are kept alive for
   * other players on the same page.
   */
  destroy() {
    this.stop();
    this._stopTimeUpdates();
    this._loaded = false;
    this._metadata = null;
    // Clear global callbacks so a destroyed component's stale handlers
    // don't interfere with the next SID player that loads.
    _activeCallbacks = null;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  _updateMetadata() {
    const p = window.ScriptNodePlayer && window.ScriptNodePlayer.getInstance();
    if (!p) return;

    const info = p.getSongInfo() || {};

    // maxSubsong from libsidplayfp is the highest 0-based subtune index,
    // so the total count is maxSubsong + 1.
    const subtunes =
      info.maxSubsong != null && info.maxSubsong >= 0
        ? info.maxSubsong + 1
        : 1;

    this._metadata = {
      title: (info.songName || "").trim(),
      author: (info.songAuthor || "").trim(),
      info: (info.songReleased || "").trim(),
      subtunes,
      preferredModel: 8580, // reSIDfp defaults to 8580
      currentModel: 8580,
    };
  }

  _startTimeUpdates() {
    this._stopTimeUpdates();
    if (!this._onTimeUpdate) return;
    this._timeUpdateId = setInterval(() => {
      if (this._onTimeUpdate) this._onTimeUpdate(this.getPlaytime());
    }, 250);
  }

  _stopTimeUpdates() {
    if (this._timeUpdateId) {
      clearInterval(this._timeUpdateId);
      this._timeUpdateId = null;
    }
  }
}
