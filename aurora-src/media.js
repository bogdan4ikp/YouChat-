'use strict';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function mediaSrc(a, width = 1200, height = 900) {
  if (a.src) return a.src;
  if (a.k === 'vid') return artSrc('video-poster:' + (a.seed || a.aid), width, height);
  return artSrc(a.seed || a.aid, width, height);
}

function posterSrc(a) {
  return mediaSrc(a, 960, 540);
}

let lightboxState = null;
let clipState = null;

function initMedia() {
  const layer = $('#lightbox');
  $('#lbClose').addEventListener('click', closeLightbox);
  $('#lbPrev').addEventListener('click', () => stepLightbox(-1));
  $('#lbNext').addEventListener('click', () => stepLightbox(1));
  $('#lbDownload').addEventListener('click', downloadCurrentMedia);
  layer.addEventListener('click', (event) => {
    if (event.target === layer) closeLightbox();
  });
}

function openLightbox(items, index = 0, opts = {}) {
  if (!items || !items.length) return;
  lightboxState = { items, index: clamp(index, 0, items.length - 1), title: opts.title || '' };
  $('#lightbox').hidden = false;
  renderLightbox();
}

function closeLightbox() {
  stopClip();
  $('#lightbox').hidden = true;
  lightboxState = null;
}

function stepLightbox(delta) {
  if (!lightboxState) return;
  stopClip();
  const total = lightboxState.items.length;
  lightboxState.index = (lightboxState.index + delta + total) % total;
  renderLightbox();
}

function currentMediaItem() {
  if (!lightboxState) return null;
  return lightboxState.items[lightboxState.index];
}

function downloadCurrentMedia() {
  const item = currentMediaItem();
  if (!item) return;
  const a = item.a;
  if (a.k === 'vid') {
    if (a.src) {
      const link = document.createElement('a');
      link.href = a.src;
      link.download = a.title || 'youchat-video';
      document.body.append(link);
      link.click();
      link.remove();
      toast('Видеофайл сохранён', 'ok');
    } else {
      toast('Это демо-клип: у него нет видеофайла для скачивания', 'warn');
    }
    return;
  }
  const src = mediaSrc(a);
  const img = new Image();
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 1200;
      canvas.height = img.naturalHeight || 900;
      canvas.getContext('2d').drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) { toast('Не удалось подготовить файл', 'warn'); return; }
        const base = (a.title || 'youchat-image').replace(/\.[a-z0-9]+$/i, '');
        downloadBlob(base + '.png', blob);
        toast('Файл сохранён', 'ok');
      }, 'image/png');
    } catch (error) {
      toast('Не удалось сохранить файл', 'warn');
    }
  };
  img.onerror = () => toast('Не удалось загрузить изображение', 'warn');
  img.src = src;
}

function renderLightbox() {
  if (!lightboxState) return;
  const { items, index } = lightboxState;
  const item = items[index];
  const { a, m, conv } = item;
  const author = person(m.author);
  const stage = $('#lbStage');
  stopClip();
  $('#lbMeta').innerHTML = `
    <b>${esc(a.title || (a.k === 'vid' ? 'Видео' : 'Изображение'))}</b>
    <span>${esc(author.name)} · ${esc(fmtDayLong(m.t))}${conv ? ' · ' + esc(convTitle(conv)) : ''}</span>`;
  $('#lbDownload').hidden = !(a.k === 'img' || (a.k === 'vid' && a.src));
  $('#lbFoot').innerHTML = `
    <span>${a.k === 'vid' ? 'Видео' : 'Изображение'} ${index + 1} из ${items.length}</span>
    <span>← → для навигации · Esc для выхода</span>`;
  $('#lbPrev').hidden = items.length < 2;
  $('#lbNext').hidden = items.length < 2;

  if (a.k === 'vid' && a.src && !a.demo) {
    stage.innerHTML = `<video class="lb-video" src="${esc(a.src)}" controls playsinline poster="${posterSrc(a)}"></video>`;
    return;
  }
  if (a.k === 'vid') {
    mountClip(stage, a);
    return;
  }
  stage.innerHTML = `<img src="${mediaSrc(a)}" alt="${esc(a.title || 'Изображение')}">`;
}

function stopClip() {
  if (clipState) {
    if (clipState.raf) cancelAnimationFrame(clipState.raf);
    clipState = null;
  }
  const video = $('#lbStage video');
  if (video) {
    try { video.pause(); } catch (error) {}
  }
}

function mountClip(stage, att) {
  const duration = Math.max(4, att.dur || 12);
  const seed = att.seed || att.aid;
  const rand = mulberry32(hashStr(String(seed)));
  const palette = ART_PALETTES[Math.floor(rand() * ART_PALETTES.length)];
  const stars = Array.from({ length: 70 }, () => ({
    x: rand(), y: rand(), r: 0.4 + rand() * 1.5, p: rand() * Math.PI * 2
  }));
  stage.innerHTML = `
    <div class="player">
      <canvas id="clipCanvas" width="880" height="495" role="img" aria-label="Демонстрационный анимированный клип «${esc(att.title || 'YouChat clip')}»"></canvas>
      <button type="button" class="big-play" id="clipBig" aria-label="Воспроизвести">${icon('play')}</button>
      <div class="player-ui">
        <button type="button" class="icon-btn" id="clipToggle" aria-label="Пауза">${icon('pause')}</button>
        <div class="progress" id="clipProgress" role="slider" aria-label="Позиция клипа" aria-valuemin="0" aria-valuemax="${duration}" aria-valuenow="0"><i id="clipBar"></i></div>
        <span class="ptime" id="clipTime">0:00 / ${fmtDur(duration)}</span>
        <span class="pbadge">демо-клип</span>
      </div>
    </div>`;
  const canvas = $('#clipCanvas');
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  let time = reducedMotion ? 2.4 : 0;
  let playing = !reducedMotion;
  let last = performance.now();
  let raf = 0;

  const big = $('#clipBig');
  const toggle = $('#clipToggle');
  const bar = $('#clipBar');
  const timeLabel = $('#clipTime');
  const progress = $('#clipProgress');

  const syncUI = () => {
    big.hidden = playing;
    toggle.innerHTML = icon(playing ? 'pause' : 'play');
    toggle.setAttribute('aria-label', playing ? 'Пауза' : 'Воспроизвести');
    bar.style.width = `${(time / duration) * 100}%`;
    timeLabel.textContent = `${fmtDur(time)} / ${fmtDur(duration)}`;
    progress.setAttribute('aria-valuenow', String(Math.round(time)));
  };

  const setPlaying = (value) => {
    playing = value;
    last = performance.now();
    syncUI();
  };

  const draw = (t) => {
    const bg = ctx.createLinearGradient(0, 0, width * 0.7, height);
    bg.addColorStop(0, '#0e0e10');
    bg.addColorStop(0.55, palette.bg[0]);
    bg.addColorStop(1, '#08080a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 5; i++) {
      const color = palette.blobs[i % palette.blobs.length];
      const cx = width * (0.2 + 0.6 * (0.5 + 0.5 * Math.sin(t * 0.14 + i * 1.7)));
      const cy = height * (0.25 + 0.5 * (0.5 + 0.5 * Math.cos(t * 0.12 + i * 2.1)));
      const radius = height * (0.32 + 0.16 * Math.sin(t * 0.2 + i));
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      glow.addColorStop(0, color + 'cc');
      glow.addColorStop(0.5, color + '55');
      glow.addColorStop(1, color + '00');
      ctx.fillStyle = glow;
      ctx.globalAlpha = 0.38;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.filter = 'blur(14px)';
    for (let i = 0; i < 3; i++) {
      const offset = i * 0.9;
      const amp = height * (0.08 + i * 0.025);
      const yBase = height * (0.36 + i * 0.13);
      const grad = ctx.createLinearGradient(0, 0, width, 0);
      grad.addColorStop(0, palette.blobs[i % palette.blobs.length] + '00');
      grad.addColorStop(0.35, palette.blobs[i % palette.blobs.length] + 'cc');
      grad.addColorStop(0.65, palette.blobs[(i + 2) % palette.blobs.length] + 'bb');
      grad.addColorStop(1, palette.blobs[(i + 2) % palette.blobs.length] + '00');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 18 + i * 9;
      ctx.beginPath();
      for (let x = -20; x <= width + 20; x += 12) {
        const n = x / width;
        const y = yBase + Math.sin(n * 5.2 + t * 0.55 + offset) * amp + Math.sin(n * 2.1 - t * 0.3) * amp * 0.45;
        if (x === -20) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';

    stars.forEach((s, idx) => {
      const alpha = 0.18 + 0.55 * (0.5 + 0.5 * Math.sin(t * 1.3 + s.p));
      ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(s.x * width, s.y * height, s.r, 0, Math.PI * 2);
      ctx.fill();
    });

    const vignette = ctx.createRadialGradient(width / 2, height * 0.45, height * 0.2, width / 2, height * 0.5, width * 0.72);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,.55)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  };

  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (playing) {
      time = (time + dt) % duration;
      draw(time);
      syncUI();
    }
    raf = requestAnimationFrame(frame);
  };

  clipState = {
    raf,
    stop() {},
    time: () => time
  };

  big.addEventListener('click', () => setPlaying(true));
  toggle.addEventListener('click', () => setPlaying(!playing));
  canvas.addEventListener('click', () => setPlaying(!playing));
  progress.addEventListener('click', (event) => {
    const r = progress.getBoundingClientRect();
    time = clamp((event.clientX - r.left) / r.width, 0, 0.999) * duration;
    draw(time);
    syncUI();
  });

  draw(time);
  syncUI();
  last = performance.now();
  raf = requestAnimationFrame(frame);
  clipState.raf = raf;
}
