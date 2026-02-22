/**
 * jsSID by Hermit (Mihaly Horvath) - JavaScript SID emulator and player
 * Version 0.9.1 (2016) - http://hermit.sidrip.com
 * License: WTFPL
 *
 * Wrapped as ES module for Discourse plugin integration.
 * Original source: https://github.com/og2t/jsSID
 *
 * Features:
 * - 6502 CPU emulation (cycle-based at audio sample rate)
 * - MOS 6581/8580 SID chip emulation with filter
 * - PSID/RSID file format support
 * - 2SID/3SID multi-chip support
 * - ADSR delay-bug simulation
 * - Combined waveform generation
 * - Vsync and CIA timing
 */

export default class SIDPlayer {
  constructor(bufferLength = 16384, backgroundNoise = 0.0005) {
    this._bufferLength = bufferLength;
    this._backgroundNoise = backgroundNoise;
    this._audioCtx = null;
    this._scriptNode = null;
    this._isPlaying = false;
    this._loaded = false;

    // Callbacks
    this._onLoad = null;
    this._onStart = null;
    this._onEnd = null;
    this._onTimeUpdate = null;

    // SID engine state - will be initialised on first use
    this._engine = null;
  }

  /**
   * Initialise the audio context (must be called from a user gesture on mobile)
   */
  _ensureAudioContext() {
    if (this._audioCtx) {
      if (this._audioCtx.state === "suspended") {
        this._audioCtx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      throw new Error("Web Audio API not supported");
    }

    this._audioCtx = new AudioCtx();
    this._engine = new SIDEngine(
      this._audioCtx.sampleRate,
      this._backgroundNoise
    );

    // Use ScriptProcessorNode (widely supported; AudioWorklet can be a V2 upgrade)
    this._scriptNode = this._audioCtx.createScriptProcessor(
      this._bufferLength,
      0,
      1
    );

    const engine = this._engine;
    const self = this;

    this._scriptNode.onaudioprocess = function (e) {
      const outData = e.outputBuffer.getChannelData(0);
      for (let i = 0; i < outData.length; i++) {
        outData[i] = engine.play();
      }
      if (self._onTimeUpdate) {
        self._onTimeUpdate(engine.getPlaytime());
      }
    };
  }

  /**
   * Load a SID file from a URL and start playback
   */
  loadAndPlay(url, subtune = 0) {
    this._ensureAudioContext();
    return this.load(url, subtune).then(() => {
      this.play();
    });
  }

  /**
   * Load a SID file from a URL (returns Promise)
   */
  load(url, subtune = 0) {
    this._ensureAudioContext();
    this.stop();

    return fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .then((buffer) => {
        const data = new Uint8Array(buffer);
        this._engine.loadSIDData(data, subtune);
        this._loaded = true;
        if (this._onLoad) {
          this._onLoad(this.getMetadata());
        }
      });
  }

  /**
   * Load a SID file from an ArrayBuffer directly
   */
  loadFromBuffer(arrayBuffer, subtune = 0) {
    this._ensureAudioContext();
    this.stop();
    const data = new Uint8Array(arrayBuffer);
    this._engine.loadSIDData(data, subtune);
    this._loaded = true;
    if (this._onLoad) {
      this._onLoad(this.getMetadata());
    }
  }

  /**
   * Start or resume playback
   */
  play() {
    if (!this._loaded || !this._scriptNode) return;
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume();
    }
    if (!this._isPlaying) {
      this._scriptNode.connect(this._audioCtx.destination);
      this._isPlaying = true;
      if (this._onStart) {
        this._onStart();
      }
    }
  }

  /**
   * Pause playback
   */
  pause() {
    if (this._isPlaying && this._scriptNode) {
      this._scriptNode.disconnect(this._audioCtx.destination);
      this._isPlaying = false;
    }
  }

  /**
   * Stop playback and reset to beginning
   */
  stop() {
    this.pause();
    if (this._engine && this._loaded) {
      this._engine.resetSubtune();
    }
  }

  /**
   * Restart playback from the beginning
   */
  restart() {
    if (!this._loaded) return;
    this.pause();
    this._engine.resetSubtune();
    this.play();
  }

  /**
   * Change to a different subtune
   */
  setSubtune(index) {
    if (!this._loaded) return;
    const wasPlaying = this._isPlaying;
    this.pause();
    this._engine.init(index);
    if (wasPlaying) {
      this.play();
    }
  }

  /**
   * Set the SID chip model (6581 or 8580)
   */
  setModel(model) {
    if (this._engine) {
      this._engine.setSIDModel(model === 6581 ? 6581.0 : 8580.0);
    }
  }

  /**
   * Set playback volume (0.0 to 1.0)
   */
  setVolume(vol) {
    if (this._engine) {
      this._engine.setVolume(vol);
    }
  }

  /**
   * Get current playtime in seconds
   */
  getPlaytime() {
    return this._engine ? this._engine.getPlaytime() : 0;
  }

  /**
   * Get SID file metadata
   */
  getMetadata() {
    if (!this._engine || !this._loaded) return null;
    return {
      title: this._engine.getTitle(),
      author: this._engine.getAuthor(),
      info: this._engine.getInfo(),
      subtunes: this._engine.getSubtunes(),
      preferredModel: this._engine.getPreferredModel(),
      currentModel: this._engine.getCurrentModel(),
    };
  }

  get isPlaying() {
    return this._isPlaying;
  }

  get isLoaded() {
    return this._loaded;
  }

  // Event setters
  set onLoad(fn) {
    this._onLoad = fn;
  }
  set onStart(fn) {
    this._onStart = fn;
  }
  set onEnd(fn) {
    this._onEnd = fn;
  }
  set onTimeUpdate(fn) {
    this._onTimeUpdate = fn;
  }

  /**
   * Clean up all resources
   */
  destroy() {
    this.stop();
    if (this._scriptNode) {
      this._scriptNode.onaudioprocess = null;
      this._scriptNode = null;
    }
    if (this._audioCtx) {
      this._audioCtx.close();
      this._audioCtx = null;
    }
    this._engine = null;
    this._loaded = false;
  }
}

/**
 * SIDEngine: the core emulation engine extracted from Hermit's jsSID.
 * Contains 6502 CPU, SID chip, and C64 memory model.
 */
class SIDEngine {
  constructor(sampleRate, backgroundNoise) {
    this._sampleRate = sampleRate;
    this._backgroundNoise = backgroundNoise;

    // Emulated machine constants
    this.C64_PAL_CPUCLK = 985248;
    this.PAL_FRAMERATE = 50;
    this.SID_CHANNEL_AMOUNT = 3;
    this.OUTPUT_SCALEDOWN = 0x10000 * this.SID_CHANNEL_AMOUNT * 16;
    this.SIDamount_vol = [0, 1, 0.6, 0.4];

    // SID file metadata
    this._title = new Uint8Array(0x20);
    this._author = new Uint8Array(0x20);
    this._info = new Uint8Array(0x20);
    this._timermode = new Uint8Array(0x20);

    // Addresses
    this._loadaddr = 0x1000;
    this._initaddr = 0x1000;
    this._playaddf = 0x1003;
    this._playaddr = 0x1003;
    this._subtune = 0;
    this._subtune_amount = 1;
    this._playlength = 0;

    this._preferred_SID_model = [8580.0, 8580.0, 8580.0];
    this._SID_model = 8580.0;
    this._SID_address = [0xd400, 0, 0];

    // 64KB C64 memory
    this._memory = new Uint8Array(65536);

    // State
    this._loaded = false;
    this._initialized = false;
    this._finished = false;
    this._playtime = 0;
    this._ended = false;

    // Timing
    this._clk_ratio = this.C64_PAL_CPUCLK / sampleRate;
    this._frame_sampleperiod = sampleRate / this.PAL_FRAMERATE;
    this._framecnt = 1;
    this._volume = 1.0;
    this._CPUtime = 0;
    this._pPC = 0;
    this._SIDamount = 1;
    this._mix = 0;

    // CPU registers
    this._PC = 0;
    this._A = 0;
    this._T = 0;
    this._X = 0;
    this._Y = 0;
    this._SP = 0xff;
    this._IR = 0;
    this._addr = 0;
    this._ST = 0x00;
    this._cyc = 0;
    this._sta = 0;

    // SID state
    this._Ast = new Float64Array(9);
    this._rcnt = new Float64Array(9);
    this._envcnt = new Float64Array(9);
    this._expcnt = new Float64Array(9);
    this._pSR = new Float64Array(9);
    this._pacc = new Float64Array(9);
    this._pracc = new Float64Array(9);
    this._sMSBrise = new Float64Array(3);
    this._sMSB = new Float64Array(3);
    this._nLFSR = new Float64Array(9).fill(0x7ffff8);
    this._prevwfout = new Float64Array(9);
    this._pwv = new Float64Array(9);
    this._plp = new Float64Array(3);
    this._pbp = new Float64Array(3);

    this._ctfr = (-2 * 3.14 * (12500 / 256)) / sampleRate;
    this._ctf_ratio_6581 = (-2 * 3.14 * (20000 / 256)) / sampleRate;

    // Working vars
    this._output = 0;

    // Constants for SID
    this.GAT = 0x01; this.SYN = 0x02; this.RNG = 0x04; this.TST = 0x08;
    this.TRI = 0x10; this.SAW = 0x20; this.PUL = 0x40; this.NOI = 0x80;
    this.HZ = 0x10; this.DECSUS = 0x40; this.ATK = 0x80;
    this.FSW = [1, 2, 4, 1, 2, 4, 1, 2, 4];
    this.LP = 0x10; this.BP = 0x20; this.HP = 0x40; this.OFF3 = 0x80;

    // CPU helper constants
    this._flagsw = [0x01, 0x21, 0x04, 0x24, 0x00, 0x40, 0x08, 0x28];
    this._brf = [0x80, 0x40, 0x01, 0x02];

    // Build combined waveform tables
    this._trsaw = new Array(4096);
    this._pusaw = new Array(4096);
    this._Pulsetrsaw = new Array(4096);
    this._buildCombinedWF(this._trsaw, 0.8, 2.4, 0.64);
    this._buildCombinedWF(this._pusaw, 1.4, 1.9, 0.68);
    this._buildCombinedWF(this._Pulsetrsaw, 0.8, 2.5, 0.64);

    // ADSR tables
    const prd0 = Math.max(this._clk_ratio, 9);
    this._Aprd = [prd0,32,63,95,149,220,267,313,392,977,1954,3126,3907,11720,19532,31251];
    this._Astp = [Math.ceil(prd0 / 9),1,1,1,1,1,1,1,1,1,1,1,1,1,1,1];
    this._Aexp = [
      1,30,30,30,30,30,30,16,16,16,16,16,16,16,16,8,8,8,8,8,8,8,8,8,8,8,8,
      4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,
      2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,
      1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
      1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
      1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
      1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
      1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1
    ];
  }

  // --- Public API ---

  loadSIDData(filedata, subtune) {
    this._loaded = false;
    this.initSID();
    this._subtune = subtune;

    const offs = filedata[7];
    this._loadaddr =
      filedata[8] + filedata[9]
        ? filedata[8] * 256 + filedata[9]
        : filedata[offs] + filedata[offs + 1] * 256;

    for (let i = 0; i < 32; i++) {
      this._timermode[31 - i] =
        filedata[0x12 + (i >> 3)] & Math.pow(2, 7 - (i % 8));
    }

    for (let i = 0; i < this._memory.length; i++) this._memory[i] = 0;

    for (let i = offs + 2; i < filedata.byteLength; i++) {
      if (this._loadaddr + i - (offs + 2) < this._memory.length) {
        this._memory[this._loadaddr + i - (offs + 2)] = filedata[i];
      }
    }

    // Parse title, author, info strings
    this._parseString(filedata, 0x16, this._title);
    this._parseString(filedata, 0x36, this._author);
    this._parseString(filedata, 0x56, this._info);

    this._initaddr =
      filedata[0xa] + filedata[0xb]
        ? filedata[0xa] * 256 + filedata[0xb]
        : this._loadaddr;
    this._playaddr = this._playaddf = filedata[0xc] * 256 + filedata[0xd];
    this._subtune_amount = filedata[0xf];

    this._preferred_SID_model[0] =
      (filedata[0x77] & 0x30) >= 0x20 ? 8580 : 6581;
    this._preferred_SID_model[1] =
      (filedata[0x77] & 0xc0) >= 0x80 ? 8580 : 6581;
    this._preferred_SID_model[2] =
      (filedata[0x76] & 3) >= 3 ? 8580 : 6581;

    this._SID_address[1] =
      filedata[0x7a] >= 0x42 && (filedata[0x7a] < 0x80 || filedata[0x7a] >= 0xe0)
        ? 0xd000 + filedata[0x7a] * 16
        : 0;
    this._SID_address[2] =
      filedata[0x7b] >= 0x42 && (filedata[0x7b] < 0x80 || filedata[0x7b] >= 0xe0)
        ? 0xd000 + filedata[0x7b] * 16
        : 0;
    this._SIDamount =
      1 + (this._SID_address[1] > 0) + (this._SID_address[2] > 0);

    this._loaded = true;
    this.init(subtune);
  }

  init(subtune) {
    if (!this._loaded) return;
    this._initialized = false;
    this._subtune = subtune;
    this._initCPU(this._initaddr);
    this.initSID();
    this._A = this._subtune;
    this._memory[1] = 0x37;
    this._memory[0xdc05] = 0;

    for (let timeout = 100000; timeout >= 0; timeout--) {
      if (this._CPU()) break;
    }

    if (this._timermode[this._subtune] || this._memory[0xdc05]) {
      if (!this._memory[0xdc05]) {
        this._memory[0xdc04] = 0x24;
        this._memory[0xdc05] = 0x40;
      }
      this._frame_sampleperiod =
        (this._memory[0xdc04] + this._memory[0xdc05] * 256) / this._clk_ratio;
    } else {
      this._frame_sampleperiod = this._sampleRate / this.PAL_FRAMERATE;
    }

    if (this._playaddf === 0) {
      this._playaddr =
        (this._memory[1] & 3) < 2
          ? this._memory[0xfffe] + this._memory[0xffff] * 256
          : this._memory[0x314] + this._memory[0x315] * 256;
    } else {
      this._playaddr = this._playaddf;
      if (this._playaddr >= 0xe000 && this._memory[1] === 0x37) {
        this._memory[1] = 0x35;
      }
    }

    this._initCPU(this._playaddr);
    this._framecnt = 1;
    this._finished = false;
    this._CPUtime = 0;
    this._playtime = 0;
    this._ended = false;
    this._initialized = true;
  }

  resetSubtune() {
    this.init(this._subtune);
  }

  play() {
    if (!this._loaded || !this._initialized) return 0;

    this._framecnt--;
    this._playtime += 1 / this._sampleRate;

    if (this._framecnt <= 0) {
      this._framecnt = this._frame_sampleperiod;
      this._finished = false;
      this._PC = this._playaddr;
      this._SP = 0xff;
    }

    if (!this._finished) {
      while (this._CPUtime <= this._clk_ratio) {
        this._pPC = this._PC;
        if (this._CPU() >= 0xfe) {
          this._finished = true;
          break;
        } else {
          this._CPUtime += this._cyc;
        }

        if (
          (this._memory[1] & 3) > 1 &&
          this._pPC < 0xe000 &&
          (this._PC === 0xea31 || this._PC === 0xea81)
        ) {
          this._finished = true;
          break;
        }

        if (
          (this._addr === 0xdc05 || this._addr === 0xdc04) &&
          (this._memory[1] & 3) &&
          this._timermode[this._subtune]
        ) {
          this._frame_sampleperiod =
            (this._memory[0xdc04] + this._memory[0xdc05] * 256) /
            this._clk_ratio;
        }

        if (
          this._sta >= 0xd420 &&
          this._sta < 0xd800 &&
          (this._memory[1] & 3)
        ) {
          if (
            !(
              this._SID_address[1] <= this._sta &&
              this._sta < this._SID_address[1] + 0x1f
            ) &&
            !(
              this._SID_address[2] <= this._sta &&
              this._sta < this._SID_address[2] + 0x1f
            )
          ) {
            this._memory[this._sta & 0xd41f] = this._memory[this._sta];
          }
        }

        if (this._addr === 0xd404 && !(this._memory[0xd404] & 1))
          this._Ast[0] &= 0x3e;
        if (this._addr === 0xd40b && !(this._memory[0xd40b] & 1))
          this._Ast[1] &= 0x3e;
        if (this._addr === 0xd412 && !(this._memory[0xd412] & 1))
          this._Ast[2] &= 0x3e;
      }
      this._CPUtime -= this._clk_ratio;
    }

    this._mix = this._SID(0, 0xd400);
    if (this._SID_address[1])
      this._mix += this._SID(1, this._SID_address[1]);
    if (this._SID_address[2])
      this._mix += this._SID(2, this._SID_address[2]);

    return (
      this._mix * this._volume * this.SIDamount_vol[this._SIDamount] +
      (Math.random() * this._backgroundNoise - this._backgroundNoise / 2)
    );
  }

  // Getters
  getTitle() {
    return this._uint8ToString(this._title);
  }
  getAuthor() {
    return this._uint8ToString(this._author);
  }
  getInfo() {
    return this._uint8ToString(this._info);
  }
  getSubtunes() {
    return this._subtune_amount;
  }
  getPreferredModel() {
    return this._preferred_SID_model[0];
  }
  getCurrentModel() {
    return this._SID_model;
  }
  getPlaytime() {
    return Math.floor(this._playtime);
  }
  getPlaytimeExact() {
    return this._playtime;
  }

  // Setters
  setSIDModel(model) {
    this._SID_model = model;
  }
  setVolume(vol) {
    this._volume = vol;
  }

  // --- Private helpers ---

  _uint8ToString(arr) {
    let end = arr.indexOf(0);
    if (end === -1) end = arr.length;
    return String.fromCharCode.apply(null, arr.subarray(0, end));
  }

  _parseString(data, offset, target) {
    let strend = 1;
    for (let i = 0; i < 32; i++) {
      if (strend !== 0) {
        strend = target[i] = data[offset + i];
      } else {
        target[i] = 0;
      }
    }
  }

  // --- CPU emulation ---

  _initCPU(mempos) {
    this._PC = mempos;
    this._A = 0;
    this._X = 0;
    this._Y = 0;
    this._ST = 0;
    this._SP = 0xff;
  }

  _CPU() {
    const M = this._memory;
    let PC = this._PC;
    let A = this._A, X = this._X, Y = this._Y, SP = this._SP, ST = this._ST;
    let IR, addr, cyc, sta, T;

    IR = M[PC];
    cyc = 2;
    sta = 0;

    if (IR & 1) {
      // Odd opcodes (ALU operations)
      switch (IR & 0x1f) {
        case 1: case 3: addr = M[M[++PC] + X] + M[M[PC] + X + 1] * 256; cyc = 6; break;
        case 0x11: case 0x13: addr = M[M[++PC]] + M[M[PC] + 1] * 256 + Y; cyc = 6; break;
        case 0x19: case 0x1f: addr = M[++PC] + M[++PC] * 256 + Y; cyc = 5; break;
        case 0x1d: addr = M[++PC] + M[++PC] * 256 + X; cyc = 5; break;
        case 0xd: case 0xf: addr = M[++PC] + M[++PC] * 256; cyc = 4; break;
        case 0x15: addr = M[++PC] + X; cyc = 4; break;
        case 5: case 7: addr = M[++PC]; cyc = 3; break;
        case 0x17: addr = M[++PC] + Y; cyc = 4; break;
        case 9: case 0xb: addr = ++PC; cyc = 2; break;
      }
      addr &= 0xffff;
      switch (IR & 0xe0) {
        case 0x60: T=A; A+=M[addr]+(ST&1); ST&=20; ST|=(A&128)|(A>255); A&=0xff; ST|=(!A)<<1|(!((T^M[addr])&0x80)&&((T^A)&0x80))>>1; break;
        case 0xe0: T=A; A-=M[addr]+!(ST&1); ST&=20; ST|=(A&128)|(A>=0); A&=0xff; ST|=(!A)<<1|(((T^M[addr])&0x80)&&((T^A)&0x80))>>1; break;
        case 0xc0: T=A-M[addr]; ST&=124; ST|=(!(T&0xff))<<1|(T&128)|(T>=0); break;
        case 0x00: A|=M[addr]; ST&=125; ST|=(!A)<<1|(A&128); break;
        case 0x20: A&=M[addr]; ST&=125; ST|=(!A)<<1|(A&128); break;
        case 0x40: A^=M[addr]; ST&=125; ST|=(!A)<<1|(A&128); break;
        case 0xa0: A=M[addr]; ST&=125; ST|=(!A)<<1|(A&128); if((IR&3)===3) X=A; break;
        case 0x80: M[addr]=A&(((IR&3)===3)?X:0xff); sta=addr; break;
      }
    } else if (IR & 2) {
      switch (IR & 0x1f) {
        case 0x1e: addr = M[++PC] + M[++PC] * 256 + (((IR & 0xc0) !== 0x80) ? X : Y); cyc = 5; break;
        case 0xe: addr = M[++PC] + M[++PC] * 256; cyc = 4; break;
        case 0x16: addr = M[++PC] + (((IR & 0xc0) !== 0x80) ? X : Y); cyc = 4; break;
        case 6: addr = M[++PC]; cyc = 3; break;
        case 2: addr = ++PC; cyc = 2; break;
      }
      addr &= 0xffff;
      switch (IR & 0xe0) {
        case 0x00: ST &= 0xfe; // fall through
        case 0x20:
          if ((IR & 0xf) === 0xa) { A=(A<<1)+(ST&1); ST&=60; ST|=(A&128)|(A>255); A&=0xff; ST|=(!A)<<1; }
          else { T=(M[addr]<<1)+(ST&1); ST&=60; ST|=(T&128)|(T>255); T&=0xff; ST|=(!T)<<1; M[addr]=T; cyc+=2; }
          break;
        case 0x40: ST &= 0xfe; // fall through
        case 0x60:
          if ((IR & 0xf) === 0xa) { T=A; A=(A>>1)+(ST&1)*128; ST&=60; ST|=(A&128)|(T&1); A&=0xff; ST|=(!A)<<1; }
          else { T=(M[addr]>>1)+(ST&1)*128; ST&=60; ST|=(T&128)|(M[addr]&1); T&=0xff; ST|=(!T)<<1; M[addr]=T; cyc+=2; }
          break;
        case 0xc0:
          if (IR & 4) { M[addr]--; M[addr]&=0xff; ST&=125; ST|=(!M[addr])<<1|(M[addr]&128); cyc+=2; }
          else { X--; X&=0xff; ST&=125; ST|=(!X)<<1|(X&128); }
          break;
        case 0xa0:
          if ((IR & 0xf) !== 0xa) X = M[addr];
          else if (IR & 0x10) { X = SP; break; }
          else X = A;
          ST &= 125; ST |= (!X) << 1 | (X & 128);
          break;
        case 0x80:
          if (IR & 4) { M[addr] = X; sta = addr; }
          else if (IR & 0x10) SP = X;
          else { A = X; ST &= 125; ST |= (!A) << 1 | (A & 128); }
          break;
        case 0xe0:
          if (IR & 4) { M[addr]++; M[addr] &= 0xff; ST &= 125; ST |= (!M[addr]) << 1 | (M[addr] & 128); cyc += 2; }
          break;
      }
    } else if ((IR & 0xc) === 8) {
      switch (IR & 0xf0) {
        case 0x60: SP++; SP&=0xff; A=M[0x100+SP]; ST&=125; ST|=(!A)<<1|(A&128); cyc=4; break;
        case 0xc0: Y++; Y&=0xff; ST&=125; ST|=(!Y)<<1|(Y&128); break;
        case 0xe0: X++; X&=0xff; ST&=125; ST|=(!X)<<1|(X&128); break;
        case 0x80: Y--; Y&=0xff; ST&=125; ST|=(!Y)<<1|(Y&128); break;
        case 0x00: M[0x100+SP]=ST; SP--; SP&=0xff; cyc=3; break;
        case 0x20: SP++; SP&=0xff; ST=M[0x100+SP]; cyc=4; break;
        case 0x40: M[0x100+SP]=A; SP--; SP&=0xff; cyc=3; break;
        case 0x90: A=Y; ST&=125; ST|=(!A)<<1|(A&128); break;
        case 0xa0: Y=A; ST&=125; ST|=(!Y)<<1|(Y&128); break;
        default:
          if (this._flagsw[IR >> 5] & 0x20) ST |= (this._flagsw[IR >> 5] & 0xdf);
          else ST &= 255 - (this._flagsw[IR >> 5] & 0xdf);
          break;
      }
    } else {
      if ((IR & 0x1f) === 0x10) {
        PC++;
        T = M[PC];
        if (T & 0x80) T -= 0x100;
        if (IR & 0x20) {
          if (ST & this._brf[IR >> 6]) { PC += T; cyc = 3; }
        } else {
          if (!(ST & this._brf[IR >> 6])) { PC += T; cyc = 3; }
        }
      } else {
        switch (IR & 0x1f) {
          case 0: addr = ++PC; cyc = 2; break;
          case 0x1c: addr = M[++PC] + M[++PC] * 256 + X; cyc = 5; break;
          case 0xc: addr = M[++PC] + M[++PC] * 256; cyc = 4; break;
          case 0x14: addr = M[++PC] + X; cyc = 4; break;
          case 4: addr = M[++PC]; cyc = 3; break;
        }
        addr &= 0xffff;
        switch (IR & 0xe0) {
          case 0x00:
            M[0x100+SP]=PC%256; SP--; SP&=0xff; M[0x100+SP]=PC/256; SP--; SP&=0xff;
            M[0x100+SP]=ST; SP--; SP&=0xff; PC=M[0xfffe]+M[0xffff]*256-1; cyc=7;
            break;
          case 0x20:
            if (IR & 0xf) { ST&=0x3d; ST|=(M[addr]&0xc0)|(!(A&M[addr]))<<1; }
            else { M[0x100+SP]=(PC+2)%256; SP--; SP&=0xff; M[0x100+SP]=(PC+2)/256; SP--; SP&=0xff; PC=M[addr]+M[addr+1]*256-1; cyc=6; }
            break;
          case 0x40:
            if (IR & 0xf) { PC=addr-1; cyc=3; }
            else { if(SP>=0xff) { this._PC=PC; this._A=A; this._X=X; this._Y=Y; this._SP=SP; this._ST=ST; this._cyc=cyc; this._sta=sta; this._addr=addr; return 0xfe; }
              SP++; SP&=0xff; ST=M[0x100+SP]; SP++; SP&=0xff; T=M[0x100+SP]; SP++; SP&=0xff; PC=M[0x100+SP]+T*256-1; cyc=6; }
            break;
          case 0x60:
            if (IR & 0xf) { PC=M[addr]+M[addr+1]*256-1; cyc=5; }
            else { if(SP>=0xff) { this._PC=PC; this._A=A; this._X=X; this._Y=Y; this._SP=SP; this._ST=ST; this._cyc=cyc; this._sta=sta; this._addr=addr; return 0xff; }
              SP++; SP&=0xff; T=M[0x100+SP]; SP++; SP&=0xff; PC=M[0x100+SP]+T*256-1; cyc=6; }
            break;
          case 0xc0: T=Y-M[addr]; ST&=124; ST|=(!(T&0xff))<<1|(T&128)|(T>=0); break;
          case 0xe0: T=X-M[addr]; ST&=124; ST|=(!(T&0xff))<<1|(T&128)|(T>=0); break;
          case 0xa0: Y=M[addr]; ST&=125; ST|=(!Y)<<1|(Y&128); break;
          case 0x80: M[addr]=Y; sta=addr; break;
        }
      }
    }

    PC++;
    PC &= 0xffff;

    // Write back
    this._PC = PC;
    this._A = A;
    this._X = X;
    this._Y = Y;
    this._SP = SP;
    this._ST = ST;
    this._cyc = cyc;
    this._sta = sta;
    this._addr = addr;
    return 0;
  }

  // --- SID chip emulation ---

  initSID() {
    const M = this._memory;
    for (let i = 0xd400; i <= 0xd7ff; i++) M[i] = 0;
    for (let i = 0xde00; i <= 0xdfff; i++) M[i] = 0;
    for (let i = 0; i < 9; i++) {
      this._Ast[i] = this.HZ;
      this._rcnt[i] = this._envcnt[i] = this._expcnt[i] = this._pSR[i] = 0;
    }
  }

  _SID(num, SIDaddr) {
    const M = this._memory;
    const CHA = this.SID_CHANNEL_AMOUNT;
    let flin = 0, output = 0;
    let pgt, chnadd, ctrl, wf, test, SR, aAdd, MSB, tmp, pw, lim, wfout, step, prd;

    for (let chn = num * CHA; chn < (num + 1) * CHA; chn++) {
      pgt = this._Ast[chn] & this.GAT;
      chnadd = SIDaddr + (chn - num * CHA) * 7;
      ctrl = M[chnadd + 4];
      wf = ctrl & 0xf0;
      test = ctrl & this.TST;
      SR = M[chnadd + 6];
      tmp = 0;

      if (pgt !== (ctrl & this.GAT)) {
        if (pgt) {
          this._Ast[chn] &= 0xff - (this.GAT | this.ATK | this.DECSUS);
        } else {
          this._Ast[chn] = this.GAT | this.ATK | this.DECSUS;
          if ((SR & 0xf) > (this._pSR[chn] & 0xf)) tmp = 1;
        }
      }
      this._pSR[chn] = SR;

      this._rcnt[chn] += this._clk_ratio;
      if (this._rcnt[chn] >= 0x8000) this._rcnt[chn] -= 0x8000;

      if (this._Ast[chn] & this.ATK) {
        step = M[chnadd + 5] >> 4;
        prd = this._Aprd[step];
      } else if (this._Ast[chn] & this.DECSUS) {
        step = M[chnadd + 5] & 0xf;
        prd = this._Aprd[step];
      } else {
        step = SR & 0xf;
        prd = this._Aprd[step];
      }
      step = this._Astp[step];

      if (this._rcnt[chn] >= prd && this._rcnt[chn] < prd + this._clk_ratio && tmp === 0) {
        this._rcnt[chn] -= prd;
        if ((this._Ast[chn] & this.ATK) || ++this._expcnt[chn] === this._Aexp[this._envcnt[chn]]) {
          if (!(this._Ast[chn] & this.HZ)) {
            if (this._Ast[chn] & this.ATK) {
              this._envcnt[chn] += step;
              if (this._envcnt[chn] >= 0xff) {
                this._envcnt[chn] = 0xff;
                this._Ast[chn] &= 0xff - this.ATK;
              }
            } else if (!(this._Ast[chn] & this.DECSUS) || this._envcnt[chn] > (SR >> 4) + (SR & 0xf0)) {
              this._envcnt[chn] -= step;
              if (this._envcnt[chn] <= 0 && this._envcnt[chn] + step !== 0) {
                this._envcnt[chn] = 0;
                this._Ast[chn] |= this.HZ;
              }
            }
          }
          this._expcnt[chn] = 0;
        }
      }
      this._envcnt[chn] &= 0xff;

      aAdd = (M[chnadd] + M[chnadd + 1] * 256) * this._clk_ratio;

      if (test || ((ctrl & this.SYN) && this._sMSBrise[num])) {
        this._pacc[chn] = 0;
      } else {
        this._pacc[chn] += aAdd;
        if (this._pacc[chn] > 0xffffff) this._pacc[chn] -= 0x1000000;
      }

      MSB = this._pacc[chn] & 0x800000;
      this._sMSBrise[num] = MSB > (this._pracc[chn] & 0x800000) ? 1 : 0;

      if (wf & this.NOI) {
        tmp = this._nLFSR[chn];
        if (
          ((this._pacc[chn] & 0x100000) !== (this._pracc[chn] & 0x100000)) ||
          aAdd >= 0x100000
        ) {
          step = (tmp & 0x400000) ^ ((tmp & 0x20000) << 5);
          tmp = ((tmp << 1) + (step > 0 || test)) & 0x7fffff;
          this._nLFSR[chn] = tmp;
        }
        wfout =
          wf & 0x70
            ? 0
            : ((tmp & 0x100000) >> 5) +
              ((tmp & 0x40000) >> 4) +
              ((tmp & 0x4000) >> 1) +
              ((tmp & 0x800) << 1) +
              ((tmp & 0x200) << 2) +
              ((tmp & 0x20) << 5) +
              ((tmp & 0x04) << 7) +
              ((tmp & 0x01) << 8);
      } else if (wf & this.PUL) {
        pw = (M[chnadd + 2] + (M[chnadd + 3] & 0xf) * 256) * 16;
        tmp = aAdd >> 9;
        if (0 < pw && pw < tmp) pw = tmp;
        tmp ^= 0xffff;
        if (pw > tmp) pw = tmp;
        tmp = this._pacc[chn] >> 8;

        if (wf === this.PUL) {
          step = 256 / (aAdd >> 16);
          if (test) {
            wfout = 0xffff;
          } else if (tmp < pw) {
            lim = (0xffff - pw) * step;
            if (lim > 0xffff) lim = 0xffff;
            wfout = lim - (pw - tmp) * step;
            if (wfout < 0) wfout = 0;
          } else {
            lim = pw * step;
            if (lim > 0xffff) lim = 0xffff;
            wfout = (0xffff - tmp) * step - lim;
            if (wfout >= 0) wfout = 0xffff;
            wfout &= 0xffff;
          }
        } else {
          wfout = tmp >= pw || test ? 0xffff : 0;
          if (wf & this.TRI) {
            if (wf & this.SAW) {
              wfout = wfout ? this._cmbWF(chn, this._Pulsetrsaw, tmp >> 4, 1) : 0;
            } else {
              tmp = this._pacc[chn] ^ (ctrl & this.RNG ? this._sMSB[num] : 0);
              wfout = wfout ? this._cmbWF(chn, this._pusaw, (tmp ^ (tmp & 0x800000 ? 0xffffff : 0)) >> 11, 0) : 0;
            }
          } else if (wf & this.SAW) {
            wfout = wfout ? this._cmbWF(chn, this._pusaw, tmp >> 4, 1) : 0;
          }
        }
      } else if (wf & this.SAW) {
        wfout = this._pacc[chn] >> 8;
        if (wf & this.TRI) {
          wfout = this._cmbWF(chn, this._trsaw, wfout >> 4, 1);
        } else {
          step = aAdd / 0x1200000;
          wfout += wfout * step;
          if (wfout > 0xffff) wfout = 0xffff - (wfout - 0x10000) / step;
        }
      } else if (wf & this.TRI) {
        tmp = this._pacc[chn] ^ (ctrl & this.RNG ? this._sMSB[num] : 0);
        wfout = (tmp ^ (tmp & 0x800000 ? 0xffffff : 0)) >> 7;
      }

      if (wf) this._prevwfout[chn] = wfout;
      else wfout = this._prevwfout[chn];

      this._pracc[chn] = this._pacc[chn];
      this._sMSB[num] = MSB;

      if (M[SIDaddr + 0x17] & this.FSW[chn]) {
        flin += (wfout - 0x8000) * (this._envcnt[chn] / 256);
      } else if ((chn % CHA) !== 2 || !(M[SIDaddr + 0x18] & this.OFF3)) {
        output += (wfout - 0x8000) * (this._envcnt[chn] / 256);
      }
    }

    // Read-back registers
    if (this._memory[1] & 3) M[SIDaddr + 0x1b] = wfout >> 8;
    M[SIDaddr + 0x1c] = this._envcnt[3];

    // Filter
    let ctf = (M[SIDaddr + 0x15] & 7) / 8 + M[SIDaddr + 0x16] + 0.2;
    let reso;
    if (this._SID_model === 8580.0) {
      ctf = 1 - Math.exp(ctf * this._ctfr);
      reso = Math.pow(2, (4 - (M[SIDaddr + 0x17] >> 4)) / 8);
    } else {
      if (ctf < 24) ctf = 0.035;
      else ctf = 1 - 1.263 * Math.exp(ctf * this._ctf_ratio_6581);
      reso = M[SIDaddr + 0x17] > 0x5f ? 8 / (M[SIDaddr + 0x17] >> 4) : 1.41;
    }

    tmp = flin + this._pbp[num] * reso + this._plp[num];
    if (M[SIDaddr + 0x18] & this.HP) output -= tmp;
    tmp = this._pbp[num] - tmp * ctf;
    this._pbp[num] = tmp;
    if (M[SIDaddr + 0x18] & this.BP) output -= tmp;
    tmp = this._plp[num] + tmp * ctf;
    this._plp[num] = tmp;
    if (M[SIDaddr + 0x18] & this.LP) output += tmp;

    this._output = output;
    return (output / this.OUTPUT_SCALEDOWN) * (M[SIDaddr + 0x18] & 0xf);
  }

  _cmbWF(chn, wfa, index, differ6581) {
    if (differ6581 && this._SID_model === 6581.0) index &= 0x7ff;
    const combiwf = (wfa[index] + this._pwv[chn]) / 2;
    this._pwv[chn] = wfa[index];
    return combiwf;
  }

  _buildCombinedWF(wfa, bitmul, bstr, trh) {
    for (let i = 0; i < 4096; i++) {
      wfa[i] = 0;
      for (let j = 0; j < 12; j++) {
        let blvl = 0;
        for (let k = 0; k < 12; k++) {
          blvl +=
            (bitmul / Math.pow(bstr, Math.abs(k - j))) *
            (((i >> k) & 1) - 0.5);
        }
        wfa[i] += blvl >= trh ? Math.pow(2, j) : 0;
      }
      wfa[i] *= 12;
    }
  }
}
