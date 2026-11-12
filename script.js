// Light / sunset / dark toggle. CSS eases the colors and slides the knob;
// this picks the theme, adds the squash, plays a small sound and
// remembers the choice. Sounds are made live with the Web Audio API,
// so there are no files to load.

// Pick one sound per theme here. The options are listed in SOUND_LIBRARY below.
var SOUND_CHOICE = {
  light: 'chime',     // chime, bell, musicbox, tick
  sunset: 'hum',      // swell, hum, windchime, tick
  dark: 'deepbell',   // pings, deepbell, twinkle, tick
  slide: 'none'       // whoosh, tick, none
};

(function () {
  var root = document.documentElement;
  var toggle = document.querySelector('.toggle');
  var face = toggle.querySelector('.toggle__face');
  var stops = Array.prototype.slice.call(toggle.querySelectorAll('.toggle__stop'));
  var moods = stops.map(function (s) { return s.dataset.mood; });
  var soundButton = document.querySelector('.sound');
  var soundLabel = soundButton.querySelector('.sound__label');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var KEY = 'lucy-theme';
  var SOUND_KEY = 'lucy-theme-sound';

  function read(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function write(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }

  /* ---------- Sound building blocks ---------- */

  var ctx = null;
  var master = null;

  // Browsers only allow audio after a tap, click or key press, so this runs on the first one
  function audio() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    }
    if (ctx.state !== 'running') ctx.resume();
    return ctx;
  }

  // Phones need two extra steps before Web Audio is heard:
  // 1. iPhones mute Web Audio when the ring switch is on silent, unless the page
  //    asks for "playback" audio. Newer Safari has audioSession for that; older
  //    Safari switches over when an ordinary audio element is playing, so a
  //    silent one loops quietly in the background.
  // 2. The audio engine must be started and play something inside the first tap.
  var silentLoop = null;
  var unlocked = false;

  function silentWav() {
    var samples = 800;
    var buffer = new ArrayBuffer(44 + samples);
    var view = new DataView(buffer);
    function text(at, s) { for (var i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); }
    text(0, 'RIFF'); view.setUint32(4, 36 + samples, true); text(8, 'WAVE');
    text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true); view.setUint32(28, 8000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
    text(36, 'data'); view.setUint32(40, samples, true);
    for (var i = 0; i < samples; i++) view.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
  }

  function unlock() {
    if (unlocked || !soundOn) return;
    unlocked = true;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    if (!navigator.audioSession) {
      silentLoop = new Audio(silentWav());
      silentLoop.loop = true;
      silentLoop.setAttribute('playsinline', '');
      silentLoop.volume = 0.01;
      var p = silentLoop.play();
      if (p && p.catch) p.catch(function () {});
    }
    if (!audio()) return;
    // A one-sample silent sound wakes the audio engine on older iPhones
    var src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
  }

  ['pointerdown', 'touchend', 'keydown'].forEach(function (type) {
    document.addEventListener(type, unlock, { capture: true, passive: true });
  });

  // Pause the silent loop when the page is hidden, so the phone can sleep
  document.addEventListener('visibilitychange', function () {
    if (!silentLoop) return;
    if (document.hidden) silentLoop.pause();
    else if (soundOn) { var p = silentLoop.play(); if (p && p.catch) p.catch(function () {}); }
  });

  // One note: a quick fade in, then a fade out
  function tone(freq, at, length, opts) {
    opts = opts || {};
    var t = ctx.currentTime + at;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (opts.glide) osc.frequency.exponentialRampToValueAtTime(freq * opts.glide, t + length);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(opts.level || 0.08, t + (opts.attack || 0.01));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain);
    gain.connect(opts.into || master);
    osc.start(t);
    osc.stop(t + length + 0.05);
  }

  // A bell: a few overtones that fade at different speeds
  function bell(freq, at, length, level) {
    [[1, 1], [2.01, 0.45], [3.02, 0.22], [4.17, 0.12]].forEach(function (p) {
      tone(freq * p[0], at, length / p[0] * 1.6, { level: level * p[1], attack: 0.005 });
    });
  }

  // Filtered noise, for breathy sounds
  function noise(at, length, from, to, level) {
    var t = ctx.currentTime + at;
    var buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * length), ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource();
    src.buffer = buffer;
    var filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.9;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + length * 0.6);
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(level, t + length * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t);
  }

  // A soft lowpass that opens and closes, for warm pads
  function warmFilter(open, length) {
    var t = ctx.currentTime;
    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(350, t);
    filter.frequency.exponentialRampToValueAtTime(open, t + length * 0.4);
    filter.frequency.exponentialRampToValueAtTime(500, t + length);
    filter.connect(master);
    return filter;
  }

  function tick(at, freq) {
    tone(freq || 2400, at, 0.06, { type: 'triangle', level: 0.05, attack: 0.002 });
  }

  /* ---------- Sound library ---------- */

  // Each sound takes how far the knob moved (1 or 2 stops)
  var SOUND_LIBRARY = {
    light: {
      chime: { name: 'Rising chime', play: function () {
        [1046.5, 1318.5, 1568, 2093].forEach(function (f, n) {
          tone(f, 0.24 + n * 0.07, 0.9, { level: 0.06 });
          tone(f * 2, 0.24 + n * 0.07, 0.4, { level: 0.012 });
        });
      } },
      bell: { name: 'Glass bell', play: function () {
        bell(1318.5, 0.2, 1.8, 0.07);
        bell(1975.5, 0.32, 1.4, 0.035);
      } },
      musicbox: { name: 'Music box', play: function () {
        [1568, 1760, 2093, 2637, 2349.3].forEach(function (f, n) {
          tone(f, 0.2 + n * 0.09, 0.5, { type: 'triangle', level: 0.045, attack: 0.003 });
        });
      } },
      tick: { name: 'Soft tick', play: function () { tick(0.18, 2600); tick(0.24, 3200); } }
    },
    sunset: {
      swell: { name: 'Warm swell', play: function () {
        var filter = warmFilter(1800, 2.2);
        [196, 196 * 1.006, 246.9, 293.7].forEach(function (f) {
          tone(f, 0.15, 2.2, { type: 'triangle', level: 0.05, attack: 0.45, glide: 0.97, into: filter });
        });
      } },
      hum: { name: 'Low hum', play: function () {
        var filter = warmFilter(900, 2.4);
        [130.8, 196, 261.6].forEach(function (f, n) {
          tone(f, 0.12, 2.4, { level: 0.07 - n * 0.015, attack: 0.6, into: filter });
        });
      } },
      windchime: { name: 'Wind chimes', play: function () {
        [1174.7, 1396.9, 1046.5, 1568, 1318.5].forEach(function (f, n) {
          bell(f, 0.2 + n * 0.16 + Math.random() * 0.05, 1.2, 0.03);
        });
        noise(0.05, 1.2, 800, 2000, 0.015);
      } },
      tick: { name: 'Soft tick', play: function () { tick(0.18, 1800); tick(0.26, 1400); } }
    },
    dark: {
      pings: { name: 'Night pings', play: function () {
        tone(220, 0.12, 1.4, { level: 0.09, attack: 0.08 });
        tone(330, 0.16, 1.2, { level: 0.04, attack: 0.1 });
        [1760, 2349.3, 2093, 2637].forEach(function (f, n) {
          tone(f, 0.42 + n * 0.12, 0.5, { type: 'triangle', level: 0.035 });
        });
      } },
      deepbell: { name: 'Deep bell', play: function () {
        bell(196, 0.16, 2.6, 0.09);
        tone(98, 0.16, 2.2, { level: 0.04, attack: 0.05 });
      } },
      twinkle: { name: 'Twinkle', play: function () {
        [2637, 3136, 2793.8, 3520, 2349.3, 3951].forEach(function (f, n) {
          tone(f, 0.38 + n * 0.09, 0.35, { level: 0.028, attack: 0.004 });
        });
      } },
      tick: { name: 'Soft tick', play: function () { tick(0.18, 1200); tick(0.26, 900); } }
    },
    slide: {
      whoosh: { name: 'Whoosh', play: function (distance) { noise(0, 0.32 + 0.12 * distance, 500, 2200, 0.05); } },
      tick: { name: 'Click', play: function () { tick(0, 1600); } },
      none: { name: 'None', play: function () {} }
    }
  };

  function playSound(group, id, distance) {
    if (!audio()) return;
    var sound = SOUND_LIBRARY[group] && SOUND_LIBRARY[group][id];
    if (sound) sound.play(distance || 1);
  }

  /* ---------- Sound on/off ---------- */

  var soundOn = read(SOUND_KEY) !== 'off';

  function play(mood, distance) {
    if (!soundOn || !audio()) return;
    var go = function () {
      playSound('slide', SOUND_CHOICE.slide, distance);
      playSound(mood, SOUND_CHOICE[mood], distance);
    };
    // On phones the engine can still be waking up; wait for it so notes aren't lost
    if (ctx.state === 'running') go();
    else ctx.resume().then(go, go);
  }

  function setSound(on) {
    soundOn = on;
    soundButton.setAttribute('aria-pressed', on ? 'true' : 'false');
    soundLabel.textContent = on ? 'Sound on' : 'Sound off';
    write(SOUND_KEY, on ? 'on' : 'off');
    if (silentLoop) {
      if (on) { var p = silentLoop.play(); if (p && p.catch) p.catch(function () {}); }
      else silentLoop.pause();
    }
  }

  soundButton.addEventListener('click', function () { setSound(!soundOn); });
  setSound(soundOn);

  // Lets a sound picker page audition the library
  window.themeSounds = { library: SOUND_LIBRARY, choice: SOUND_CHOICE, play: playSound };

  /* ---------- Theme ---------- */

  function setMood(mood, animate) {
    var from = moods.indexOf(root.dataset.mood);
    var i = moods.indexOf(mood);
    if (i < 0 || i === from) return;
    root.dataset.mood = mood;
    toggle.style.setProperty('--i', i);
    stops.forEach(function (s, n) {
      s.setAttribute('aria-checked', n === i ? 'true' : 'false');
      s.tabIndex = n === i ? 0 : -1;
    });
    write(KEY, mood);
    if (!animate) return;

    play(mood, Math.abs(i - from));

    // The knob stretches along its path, then settles back to a circle
    if (face.animate && !reduced.matches) {
      var stretch = 1 + 0.16 * Math.abs(i - from);
      face.animate(
        [
          { transform: 'scale(1, 1)' },
          { transform: 'scale(' + stretch + ', ' + (2 - stretch) + ')', offset: 0.45 },
          { transform: 'scale(0.96, 1.04)', offset: 0.8 },
          { transform: 'scale(1, 1)' }
        ],
        { duration: 680, easing: 'ease-in-out' }
      );
    }
  }

  stops.forEach(function (s) {
    s.addEventListener('click', function () { setMood(s.dataset.mood, true); });
  });

  // Arrow keys move between stops, like any radio group
  toggle.addEventListener('keydown', function (e) {
    var i = moods.indexOf(root.dataset.mood);
    var next = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: moods.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    next = (next + moods.length) % moods.length;
    setMood(moods[next], true);
    stops[next].focus();
  });

  // Start on the saved theme, or match the device, without animating or sound
  var start = read(KEY);
  if (moods.indexOf(start) < 0) {
    start = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  root.classList.add('is-instant');
  setMood(start, false);
  requestAnimationFrame(function () {
    requestAnimationFrame(function () { root.classList.remove('is-instant'); });
  });
})();
