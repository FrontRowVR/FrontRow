/* ════════════════════════════════════════════════════════════════════════
   FirstRow VR · Reproductor VR 180°/360° compartido
   ─────────────────────────────────────────────────────────────────────────
   Un único reproductor para todas las páginas. Inyecta su propio modal y
   gestiona: estéreo (Auto/Mono/SBS/TB), proyección (180°/360°), velocidad,
   play/pausa, barra de progreso, volumen, recentrado, pantalla completa,
   indicador de buffering, atajos de teclado y recuperación tras el reposo
   del visor (pérdida de contexto WebGL en Meta Quest, etc).

   Requisitos en la página: A-Frame y vr-player.css cargados.
   API pública:
     VRPlayer.open(src)  → abre el visor con la URL de video indicada
     VRPlayer.close()    → cierra el visor
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Textos (es/en) ──
  var T = {
    es: { loading: 'Cargando experiencia VR…', error: 'No se pudo reproducir: ',
          hint: 'Arrastra para girar la vista · Pulsa el botón VR para entrar',
          stereo: '3D / Estéreo', projection: 'Proyección', speed: 'Velocidad',
          vrBadge: 'Visor VR listo · pulsa para entrar', vrOn: 'Entrar en VR (visor listo)', vrOff: 'No se detecta un visor VR',
          tooHeavy: 'Este dispositivo no logra reproducir el video. Suele ocurrir cuando la resolución o el códec superan lo que puede decodificar por hardware (en 8K solo HEVC/AV1 van acelerados; H.264 cae a software y bloquea el navegador).' },
    en: { loading: 'Loading VR experience…', error: 'Could not play: ',
          hint: 'Drag to look around · Press the VR button to enter',
          stereo: '3D / Stereo', projection: 'Projection', speed: 'Speed',
          vrBadge: 'VR headset ready · tap to enter', vrOn: 'Enter VR (headset ready)', vrOff: 'No VR headset detected',
          tooHeavy: 'This device cannot play the video. It usually means the resolution or codec exceeds what it can decode in hardware (at 8K only HEVC/AV1 are accelerated; H.264 falls back to software and freezes the browser).' }
  };
  function lang() {
    return (document.documentElement.lang || 'es').toLowerCase().indexOf('en') === 0 ? 'en' : 'es';
  }
  function L() { return T[lang()] || T.es; }

  // ── Estado del reproductor (se conserva entre videos) ──
  var state = { stereo: 'auto', projection: 180, speed: 1 };
  var els = {};
  var hideTimer = null;
  var inited = false;
  var startWatch = null;

  // ── Vigilante de arranque ───────────────────────────────────────────────
  // Un códec que el equipo no decodifica por hardware no produce ningún error:
  // el navegador cae a decodificación por software y la pestaña se congela sin
  // decir nada. Si a los 25 s el video sigue en 0, avisamos en vez de dejar el
  // spinner girando para siempre.
  function armStartWatchdog() {
    clearTimeout(startWatch);
    startWatch = setTimeout(function () {
      if (!els.modal || !els.modal.classList.contains('open')) return;
      if (els.video.currentTime > 0.1) return;
      els.loading.classList.remove('show');
      els.error.classList.add('show');
      el('vrErrorMsg').textContent = L().tooHeavy;
    }, 25000);
  }
  function disarmStartWatchdog() { clearTimeout(startWatch); startWatch = null; }

  // ── Disponibilidad del visor VR (WebXR) ──
  var vrReady = false;
  function setVRReady(ready) {
    vrReady = !!ready;
    if (!els.enterBtn) return;
    els.enterBtn.disabled = !vrReady;
    els.enterBtn.classList.toggle('is-ready', vrReady);
    els.enterBtn.title = vrReady ? L().vrOn : L().vrOff;
  }
  function showReadyBadge() {
    if (!els.readyBadge) return;
    els.readyBadge.classList.add('show');
    clearTimeout(showReadyBadge._t);
    showReadyBadge._t = setTimeout(function () { els.readyBadge.classList.remove('show'); }, 4500);
  }
  function checkVR() {
    if (!navigator.xr || !navigator.xr.isSessionSupported) { setVRReady(false); return; }
    navigator.xr.isSessionSupported('immersive-vr').then(function (ok) {
      var was = vrReady;
      setVRReady(ok);
      if (ok && !was && els.modal && els.modal.classList.contains('open')) showReadyBadge();
    }).catch(function () { setVRReady(false); });
  }

  function el(id) { return document.getElementById(id); }

  function modalHTML() {
    var s = L();
    return '' +
      '<div class="vr-modal-bar">' +
        '<a href="/" class="vr-modal-logo" aria-label="Ir al inicio" title="Ir al inicio"><img src="FirstRow.png?v=2" alt="FirstRow VR" class="logo-img" /></a>' +
        '<button class="vr-modal-close" id="closeVrPlayer" aria-label="Cerrar visor">✕</button>' +
      '</div>' +
      '<div class="vr-loading" id="vrLoading"><div class="vr-spinner"></div><p>' + s.loading + '</p></div>' +
      '<div class="vr-error" id="vrError"><p id="vrErrorMsg">Error</p></div>' +
      '<video id="vrVideo" crossorigin="anonymous" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px" loop playsinline webkit-playsinline preload="auto"></video>' +
      '<a-scene id="vrScene" embedded vr-mode-ui="enabled: false" loading-screen="dotsColor: #00e5ff; backgroundColor: #050507" renderer="antialias: true; colorManagement: true">' +
        '<a-sky color="#050507"></a-sky>' +
        // Las mallas del video (una por ojo) las crea buildRig() directamente en THREE.
        '<a-camera look-controls="reverseMouseDrag: false" wasd-controls="enabled: false"></a-camera>' +
      '</a-scene>' +
      '<div id="vrControls" class="vr-controls">' +
        '<button id="vrPlayPause" class="vr-ctrl-btn" aria-label="Reproducir / Pausar">' +
          '<svg id="iconPlay" viewBox="0 0 24 24" fill="currentColor" style="display:none"><polygon points="5,3 19,12 5,21"/></svg>' +
          '<svg id="iconPause" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>' +
        '</button>' +
        '<div class="vr-progress-wrap">' +
          '<input type="range" id="vrSeekBar" class="vr-seekbar" min="0" max="100" value="0" step="0.1" />' +
          '<span id="vrTime" class="vr-time">0:00 / 0:00</span>' +
        '</div>' +
        '<div class="vr-volume-wrap">' +
          '<button id="vrMuteBtn" class="vr-ctrl-btn" aria-label="Silenciar / Activar sonido">' +
            '<svg id="iconVol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg>' +
            '<svg id="iconMute" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>' +
          '</button>' +
          '<input type="range" id="vrVolBar" class="vr-volbar" min="0" max="1" value="1" step="0.05" />' +
        '</div>' +
        '<button id="vrRecenter" class="vr-ctrl-btn" aria-label="Recentrar vista" title="Recentrar vista">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><polyline points="3 3 3 8 8 8"/></svg>' +
        '</button>' +
        '<div class="vr-settings-wrap">' +
          '<button id="vrSettingsBtn" class="vr-ctrl-btn" aria-label="Ajustes" title="Ajustes">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' +
          '</button>' +
          '<div id="vrSettingsPanel" class="vr-settings-panel">' +
            '<div class="vr-set-group"><span class="vr-set-label">' + s.stereo + '</span>' +
              '<div class="vr-set-opts" data-set="stereo">' +
                '<button class="vr-set-opt is-active" data-val="auto">Auto</button>' +
                '<button class="vr-set-opt" data-val="mono">Mono</button>' +
                '<button class="vr-set-opt" data-val="sbs">SBS</button>' +
                '<button class="vr-set-opt" data-val="tb">TB</button>' +
              '</div></div>' +
            '<div class="vr-set-group"><span class="vr-set-label">' + s.projection + '</span>' +
              '<div class="vr-set-opts" data-set="projection">' +
                '<button class="vr-set-opt is-active" data-val="180">180°</button>' +
                '<button class="vr-set-opt" data-val="360">360°</button>' +
              '</div></div>' +
            '<div class="vr-set-group"><span class="vr-set-label">' + s.speed + '</span>' +
              '<div class="vr-set-opts" data-set="speed">' +
                '<button class="vr-set-opt" data-val="0.5">0.5×</button>' +
                '<button class="vr-set-opt" data-val="0.75">0.75×</button>' +
                '<button class="vr-set-opt is-active" data-val="1">1×</button>' +
                '<button class="vr-set-opt" data-val="1.25">1.25×</button>' +
                '<button class="vr-set-opt" data-val="1.5">1.5×</button>' +
                '<button class="vr-set-opt" data-val="2">2×</button>' +
              '</div></div>' +
          '</div>' +
        '</div>' +
        '<button id="vrEnterBtn" class="vr-ctrl-btn vr-enter-btn" aria-label="Entrar en VR" disabled>' +
          '<span class="vr-ready-dot"></span>' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8H3a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h4.5a2 2 0 0 0 1.7-1l.9-1.4a1 1 0 0 1 1.7 0l.9 1.4a2 2 0 0 0 1.7 1H21a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2z"/></svg>' +
        '</button>' +
        '<button id="vrFullscreen" class="vr-ctrl-btn" aria-label="Pantalla completa" title="Pantalla completa">' +
          '<svg id="iconFsOpen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>' +
          '<svg id="iconFsClose" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>' +
        '</button>' +
      '</div>' +
      '<div id="vrBuffer" class="vr-buffer"></div>' +
      '<div id="vrReadyBadge" class="vr-ready-badge"><span class="vr-ready-badge-dot"></span><span>' + s.vrBadge + '</span></div>' +
      '<p class="vr-modal-hint" id="vrHint">' + s.hint + '</p>';
  }

  function fmtTime(sec) {
    if (isNaN(sec)) return '0:00';
    var m = Math.floor(sec / 60), ss = Math.floor(sec % 60);
    return m + ':' + (ss < 10 ? '0' : '') + ss;
  }

  function showControls() {
    els.controls.classList.remove('hidden');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      if (!els.video.paused) els.controls.classList.add('hidden');
    }, 3000);
  }

  // ── Rig estéreo: UNA MALLA POR OJO ──────────────────────────────────────
  // Dentro del visor, three.js renderiza la escena una vez por ojo y decide qué
  // ve cada cámara con "layers": la izquierda ve la capa 1 y la derecha la 2.
  // Con una sola malla ambos ojos reciben la MISMA mitad del frame, así que el
  // video se ve plano (sin profundidad) dentro del visor. Por eso montamos dos
  // mallas que comparten la textura del video y solo difieren en sus UV.
  var rig = { meshes: [], texture: null };

  // Empaquetado estéreo. Respeta la elección manual; en 'auto' compara el
  // aspecto real con el que tendría el mismo video si fuera mono (1:1 en 180°,
  // 2:1 en 360°), en vez de asumir que todo lo más ancho que 16:9 es SBS.
  function resolveStereo(video) {
    if (state.stereo !== 'auto') return state.stereo;
    var vw = video.videoWidth || 0, vh = video.videoHeight || 0;
    if (!vw || !vh) return 'mono';
    var r = (vw / vh) / (state.projection === 360 ? 2 : 1);
    if (r >= 1.6)  return 'sbs';   // ~el doble de ancho → ojos lado a lado
    if (r <= 0.65) return 'tb';    // ~la mitad de alto  → ojos apilados
    return 'mono';
  }

  // Hemisferio (180°) o esfera completa (360°) alrededor del espectador.
  // phiStart = -90° - phiLength/2 deja el CENTRO del video en -Z (justo al
  // frente de la cámara) y hace que u crezca hacia la derecha.
  // scale(-1,1,1) voltea las caras hacia adentro sin espejar la imagen: es el
  // mismo truco de <a-videosphere>. Usar side: BackSide en su lugar deja el
  // video invertido en horizontal.
  function eyeGeometry(deg, mode, eye) {
    var phiLength = deg * Math.PI / 180;
    var geo = new THREE.SphereGeometry(100, 64, 48, -Math.PI / 2 - phiLength / 2, phiLength, 0, Math.PI);
    geo.scale(-1, 1, 1);
    var uv = geo.attributes.uv, i;
    if (mode === 'sbs') {
      for (i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5 + (eye === 'right' ? 0.5 : 0));
    } else if (mode === 'tb') {
      // uv.y = 1 es el borde SUPERIOR del frame → el ojo izquierdo va arriba.
      for (i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * 0.5 + (eye === 'right' ? 0 : 0.5));
    }
    uv.needsUpdate = true;
    return geo;
  }

  function disposeRig() {
    var parent = els.scene && els.scene.object3D;
    rig.meshes.forEach(function (m) {
      if (parent) parent.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    });
    rig.meshes = [];
    if (rig.texture) { rig.texture.dispose(); rig.texture = null; }
  }

  // Fuera del visor la cámara solo ve la capa 0, así que hay que habilitarle la
  // capa 1 para que la vista plana muestre el ojo izquierdo.
  function enableFlatEye() {
    var cam = els.scene && els.scene.camera;
    if (cam) cam.layers.enable(1);
  }

  // Reparto de capas. Dentro del visor cada ojo ve SOLO su malla (1 y 2). Fuera
  // del visor la malla izquierda se publica además en la capa 0, que toda cámara
  // ve por defecto: así la vista plana nunca depende de que enableFlatEye() haya
  // alcanzado a correr (si fallaba, la pantalla quedaba negra en todos los videos).
  function applyEyeLayers() {
    if (rig.meshes.length < 2) return;
    var inVR = !!(els.scene && els.scene.is && els.scene.is('vr-mode'));
    rig.meshes[0].layers.set(1);
    if (!inVR) rig.meshes[0].layers.enable(0);
    rig.meshes[1].layers.set(2);
  }

  function buildRig(video) {
    if (!window.THREE || !els.scene) return;
    if (!els.scene.hasLoaded || !els.scene.object3D) {
      els.scene.addEventListener('loaded', function () { buildRig(video); }, { once: true });
      return;
    }
    disposeRig();

    var texture = new THREE.VideoTexture(video);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    // Sin mipmaps el filtrado anisotrópico no aporta nada (es una técnica que
    // se apoya en ellos), así que no se toca: solo encarecía el muestreo.
    if (THREE.SRGBColorSpace !== undefined) texture.colorSpace = THREE.SRGBColorSpace;
    else if (THREE.sRGBEncoding !== undefined) texture.encoding = THREE.sRGBEncoding;
    rig.texture = texture;

    if (video.videoWidth > 4096 && window.console) {
      console.info('[VRPlayer] frame ' + video.videoWidth + 'x' + video.videoHeight +
        ' — a esta resolución solo HEVC/AV1 se decodifican por hardware; en H.264 el navegador cae a software.');
    }

    var mode = resolveStereo(video);
    [['left', 1], ['right', 2]].forEach(function (pair) {
      var mesh = new THREE.Mesh(
        eyeGeometry(state.projection, mode, pair[0]),
        new THREE.MeshBasicMaterial({ map: texture })
      );
      mesh.layers.set(pair[1]);   // 1 = ojo izquierdo · 2 = ojo derecho
      mesh.frustumCulled = false;
      els.scene.object3D.add(mesh);
      rig.meshes.push(mesh);
    });
    applyEyeLayers();
    enableFlatEye();
  }

  // 180° = hemisferio, 360° = esfera completa (regenera la geometría).
  function setProjection(deg) {
    state.projection = deg;
    if (els.video && els.video.src) buildRig(els.video);
  }

  // Marca el botón activo en el panel de ajustes.
  function setActive(group, val) {
    if (!els.settingsPanel) return;
    els.settingsPanel.querySelectorAll('.vr-set-opts[data-set="' + group + '"] .vr-set-opt')
      .forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-val') === String(val)); });
  }

  function updateMuteIcon() {
    var v = els.video, muted = v.muted || v.volume === 0;
    el('iconVol').style.display = muted ? 'none' : '';
    el('iconMute').style.display = muted ? '' : 'none';
    els.volBar.style.backgroundSize = (muted ? 0 : v.volume * 100) + '% 100%';
  }

  // open(src, opts) — opts.stereo: 'auto'|'mono'|'sbs'|'tb' · opts.projection: 180|360
  // Cada video declara su propio formato en el catálogo; 'auto' solo es el
  // respaldo cuando no se especifica, porque adivinar por aspecto no es fiable
  // (un 2:1 puede ser 360° mono, VR180 SBS o VR180 TB).
  function open(src, opts) {
    init();
    opts = opts || {};
    var v = els.video;
    state.stereo     = opts.stereo || 'auto';
    state.projection = opts.projection ? parseInt(opts.projection, 10) : 180;
    setActive('stereo', state.stereo);
    setActive('projection', state.projection);
    els.modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    els.error.classList.remove('show');
    els.loading.classList.add('show');
    els.controls.classList.remove('hidden');
    if (vrReady) showReadyBadge(); else checkVR();
    // Reset de controles
    els.seekBar.value = 0; els.seekBar.style.backgroundSize = '0% 100%';
    els.time.textContent = '0:00 / 0:00';
    el('iconPlay').style.display = 'none'; el('iconPause').style.display = '';
    el('iconVol').style.display = ''; el('iconMute').style.display = 'none';
    els.volBar.value = 1; els.volBar.style.backgroundSize = '100% 100%';
    v.muted = false; v.volume = 1;
    v.src = src; v.load();
    armStartWatchdog();
    v.play().then(function () {
      els.loading.classList.remove('show');
      buildRig(v);
      v.playbackRate = state.speed;
      showControls();
    }).catch(function (err) {
      disarmStartWatchdog();
      els.loading.classList.remove('show');
      els.error.classList.add('show');
      el('vrErrorMsg').textContent = L().error + (err && err.message ? err.message : err);
    });
  }

  function close() {
    if (!els.modal) return;
    // Si seguimos dentro del visor hay que cerrar la sesión WebXR: ocultar el
    // modal no la termina y el visor se queda con la escena colgada.
    if (els.scene && els.scene.is && els.scene.is('vr-mode') && typeof els.scene.exitVR === 'function') {
      els.scene.exitVR();
    }
    els.modal.classList.remove('open');
    document.body.style.overflow = '';
    clearTimeout(hideTimer);
    disarmStartWatchdog();
    els.video.pause();
    els.video.removeAttribute('src');
    els.video.load();
    disposeRig();
    if (document.fullscreenElement) {
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document);
    }
  }

  function wire() {
    var v = els.video;

    el('closeVrPlayer').addEventListener('click', close);
    els.modal.addEventListener('mousemove', showControls);
    els.modal.addEventListener('touchstart', showControls, { passive: true });

    // Play / pausa
    el('vrPlayPause').addEventListener('click', function () {
      if (v.paused) v.play(); else v.pause();
    });
    v.addEventListener('play', function () {
      el('iconPlay').style.display = 'none'; el('iconPause').style.display = '';
    });
    v.addEventListener('pause', function () {
      el('iconPlay').style.display = ''; el('iconPause').style.display = 'none';
      els.controls.classList.remove('hidden'); clearTimeout(hideTimer);
    });

    // Progreso / seek
    v.addEventListener('timeupdate', function () {
      if (!v.duration) return;
      var pct = (v.currentTime / v.duration) * 100;
      els.seekBar.value = pct;
      els.seekBar.style.backgroundSize = pct + '% 100%';
      els.time.textContent = fmtTime(v.currentTime) + ' / ' + fmtTime(v.duration);
    });
    els.seekBar.addEventListener('input', function () {
      if (!v.duration) return;
      v.currentTime = (els.seekBar.value / 100) * v.duration;
      showControls();
    });

    // Volumen / mute
    els.volBar.addEventListener('input', function () {
      v.volume = parseFloat(els.volBar.value);
      v.muted = v.volume === 0;
      updateMuteIcon(); showControls();
    });
    el('vrMuteBtn').addEventListener('click', function () {
      v.muted = !v.muted;
      if (!v.muted && v.volume === 0) { v.volume = 0.5; els.volBar.value = 0.5; }
      updateMuteIcon();
    });

    // Ajustes (estéreo / proyección / velocidad)
    var settingsBtn = el('vrSettingsBtn'), panel = els.settingsPanel;
    settingsBtn.addEventListener('click', function (e) { e.stopPropagation(); panel.classList.toggle('open'); showControls(); });
    panel.addEventListener('click', function (e) { e.stopPropagation(); });
    panel.addEventListener('mousemove', showControls);
    document.addEventListener('click', function () { panel.classList.remove('open'); });

    panel.querySelectorAll('.vr-set-opt').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var group = btn.parentElement.getAttribute('data-set');
        var val = btn.getAttribute('data-val');
        setActive(group, val);
        if (group === 'stereo')          { state.stereo = val; if (v.src) buildRig(v); }
        else if (group === 'projection') { setProjection(parseInt(val, 10)); }
        else if (group === 'speed')      { state.speed = parseFloat(val); v.playbackRate = state.speed; }
        showControls();
      });
    });

    // Recentrar vista (magic-window; dentro del visor lo recentra el sistema)
    el('vrRecenter').addEventListener('click', function () {
      var cam = document.querySelector('#vrScene a-camera, #vrScene [camera]');
      var lc = cam && cam.components && cam.components['look-controls'];
      if (lc && lc.pitchObject && lc.yawObject) { lc.pitchObject.rotation.x = 0; lc.yawObject.rotation.y = 0; }
      showControls();
    });

    // Pantalla completa
    el('vrFullscreen').addEventListener('click', function () {
      if (!document.fullscreenElement) {
        var req = els.modal.requestFullscreen || els.modal.webkitRequestFullscreen;
        if (req) req.call(els.modal);
      } else {
        var exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) exit.call(document);
      }
      showControls();
    });
    document.addEventListener('fullscreenchange', function () {
      var fs = !!document.fullscreenElement;
      el('iconFsOpen').style.display = fs ? 'none' : '';
      el('iconFsClose').style.display = fs ? '' : 'none';
    });

    // Entrar en VR + detección del visor (WebXR)
    el('vrEnterBtn').addEventListener('click', function () {
      if (!vrReady || !els.scene) return;
      var scene = els.scene;
      if (typeof scene.enterVR !== 'function') return;
      // A-Frame cae a fullscreen cuando checkHeadsetConnected() es false (no detecta
      // bien visores WebXR en desktop: Quest Link / SteamVR / emulador). Como ya
      // confirmamos que immersive-vr está soportado (vrReady), forzamos la ruta WebXR.
      var origCheck = scene.checkHeadsetConnected;
      if (typeof origCheck === 'function') scene.checkHeadsetConnected = function () { return true; };
      var restore = function () { if (typeof origCheck === 'function') scene.checkHeadsetConnected = origCheck; };
      try {
        var p = scene.enterVR();
        if (p && p.then) p.then(restore, function (e) { restore(); if (window.console) console.warn('[VRPlayer] enterVR:', e && e.message ? e.message : e); });
        else restore();
      } catch (e) { restore(); if (window.console) console.warn('[VRPlayer] enterVR error:', e); }
      showControls();
    });
    if (navigator.xr && navigator.xr.addEventListener) {
      navigator.xr.addEventListener('devicechange', checkVR);
    }
    els.scene.addEventListener('enter-vr', function () {
      if (els.readyBadge) els.readyBadge.classList.remove('show');
      applyEyeLayers();
    });
    els.scene.addEventListener('exit-vr', applyEyeLayers);
    // La cámara se crea (y puede reemplazarse) de forma asíncrona: hay que
    // rehabilitarle la capa 1 cada vez o la vista plana se queda en negro.
    els.scene.addEventListener('camera-set-active', enableFlatEye);
    if (els.scene.hasLoaded) enableFlatEye();
    else els.scene.addEventListener('loaded', enableFlatEye);
    checkVR();

    // Indicador de buffering
    ['waiting', 'stalled'].forEach(function (ev) {
      v.addEventListener(ev, function () { if (els.modal.classList.contains('open')) els.buffer.classList.add('show'); });
    });
    ['playing', 'canplay', 'timeupdate'].forEach(function (ev) {
      v.addEventListener(ev, function () { els.buffer.classList.remove('show'); });
    });
    v.addEventListener('playing', disarmStartWatchdog);

    // Atajos de teclado
    document.addEventListener('keydown', function (e) {
      if (!els.modal.classList.contains('open')) return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); el('vrPlayPause').click(); showControls(); }
      if (e.key === 'm') { el('vrMuteBtn').click(); showControls(); }
      if (e.key === 'ArrowRight') { v.currentTime = Math.min(v.duration || 0, v.currentTime + 10); showControls(); }
      if (e.key === 'ArrowLeft')  { v.currentTime = Math.max(0, v.currentTime - 10); showControls(); }
    });

    // ── Recuperación tras reposo / pérdida de contexto WebGL ──
    function recover() {
      if (!els.modal.classList.contains('open')) return;
      if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
      buildRig(v);
    }
    function bindCanvas() {
      var canvas = els.scene.renderer && els.scene.renderer.domElement;
      if (!canvas) { setTimeout(bindCanvas, 300); return; }
      // preventDefault es OBLIGATORIO para que el contexto pueda restaurarse
      canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); }, false);
      canvas.addEventListener('webglcontextrestored', function () { setTimeout(recover, 60); }, false);
    }
    if (els.scene.hasLoaded) bindCanvas();
    else els.scene.addEventListener('loaded', bindCanvas);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') setTimeout(recover, 150);
    });
    els.scene.addEventListener('exit-vr', function () { setTimeout(recover, 150); });
  }

  // Crea el modal (una sola vez) la primera vez que se abre un video.
  function init() {
    if (inited) return;
    if (!window.THREE || !window.AFRAME) {
      console.error('[VRPlayer] A-Frame no está cargado. Añade el <script> de A-Frame antes de vr-player.js.');
    }
    inited = true;
    var modal = document.createElement('div');
    modal.id = 'vrModal';
    modal.className = 'vr-modal';
    modal.innerHTML = modalHTML();
    document.body.appendChild(modal);
    els = {
      modal: modal,
      video: el('vrVideo'),
      scene: el('vrScene'),
      loading: el('vrLoading'),
      error: el('vrError'),
      controls: el('vrControls'),
      seekBar: el('vrSeekBar'),
      time: el('vrTime'),
      volBar: el('vrVolBar'),
      settingsPanel: el('vrSettingsPanel'),
      buffer: el('vrBuffer'),
      enterBtn: el('vrEnterBtn'),
      readyBadge: el('vrReadyBadge')
    };
    wire();
  }

  window.VRPlayer = { open: open, close: close };
})();
