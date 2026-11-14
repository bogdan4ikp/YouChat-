'use strict';

/* Ручная обрезка: фото или кадр из видео. kind: 'avatar' (круг) | 'banner' (прямоугольник 5:2). Возвращает dataURL или null. */
function cropMedia(file, kind) {
  return new Promise((resolve) => {
    const circle = kind === 'avatar';
    const isVideo = file.type.startsWith('video/');
    const [outW, outH] = circle ? [320, 320] : [1200, 480];
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const html = `<div class="modal-pad crop">
      <h2 class="modal-title">${circle ? 'Фото профиля' : 'Баннер'}</h2>
      <p class="modal-sub">Двигайте фото пальцем и приближайте — в рамке останется то, что вы выбрали.</p>
      <div class="crop-stage" id="cropStage"><img id="cropImg" alt="" draggable="false"><div class="crop-frame ${circle ? 'is-circle' : ''}" id="cropFrame"></div></div>
      ${isVideo ? '<label class="crop-row"><span>Кадр</span><input type="range" id="cropSeek" min="0" max="1000" value="0"></label>' : ''}
      <label class="crop-row"><span>Масштаб</span><input type="range" id="cropZoom" min="100" max="400" value="100"></label>
      <div class="form-actions">
        <button type="button" class="btn" data-modal-close>Отмена</button>
        <button type="button" class="btn primary" id="cropOk" disabled>${icon('check')}<span>Готово</span></button>
      </div>
    </div>`;
    const entry = openModal(html, {
      size: 'sm',
      label: circle ? 'Обрезка фото профиля' : 'Обрезка баннера',
      onMount: (modal) => {
        const stage = $('#cropStage', modal);
        const frame = $('#cropFrame', modal);
        const img = $('#cropImg', modal);
        const zoom = $('#cropZoom', modal);
        const ok = $('#cropOk', modal);
        const stageW = stage.clientWidth || 300;
        const fw = circle ? Math.min(260, stageW - 40) : stageW - 40;
        const fh = circle ? fw : fw * (outH / outW);
        stage.style.height = Math.round(fh + 56) + 'px';
        frame.style.width = fw + 'px';
        frame.style.height = fh + 'px';

        let source = null;
        let iw = 1;
        let ih = 1;
        let z = 1;
        let cx = 0;
        let cy = 0;
        const base = () => Math.max(fw / iw, fh / ih);
        const apply = () => {
          const s = base() * z;
          const mx = Math.max(0, (iw * s - fw) / 2);
          const my = Math.max(0, (ih * s - fh) / 2);
          cx = clamp(cx, -mx, mx);
          cy = clamp(cy, -my, my);
          img.style.width = iw + 'px';
          img.style.height = ih + 'px';
          img.style.transform = `translate(-50%,-50%) translate(${cx}px,${cy}px) scale(${s})`;
          zoom.value = String(Math.round(z * 100));
        };
        const ready = (src, w, h, imgSrc) => {
          source = src;
          iw = w;
          ih = h;
          if (imgSrc) img.src = imgSrc;
          ok.disabled = false;
          apply();
        };

        if (isVideo) {
          const video = document.createElement('video');
          video.muted = true;
          video.playsInline = true;
          video.preload = 'auto';
          const grab = () => {
            const k = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(video.videoWidth * k);
            canvas.height = Math.round(video.videoHeight * k);
            canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
            ready(canvas, canvas.width, canvas.height, canvas.toDataURL('image/jpeg', 0.9));
          };
          video.addEventListener('loadedmetadata', () => { video.currentTime = Math.min(0.1, video.duration || 0); });
          video.addEventListener('seeked', grab);
          video.addEventListener('error', () => { toast('Не удалось открыть видео', 'warn'); closeModal(); });
          video.src = url;
          $('#cropSeek', modal).addEventListener('input', (event) => {
            if (video.duration) video.currentTime = (Number(event.target.value) / 1000) * video.duration;
          });
        } else {
          const image = new Image();
          image.onload = () => ready(image, image.naturalWidth, image.naturalHeight, url);
          image.onerror = () => { toast('Не удалось открыть изображение', 'warn'); closeModal(); };
          image.src = url;
        }

        const pointers = new Map();
        let pinch = null;
        stage.addEventListener('pointerdown', (event) => {
          stage.setPointerCapture(event.pointerId);
          pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pointers.size === 2) {
            const [a, b] = Array.from(pointers.values());
            pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z };
          }
        });
        stage.addEventListener('pointermove', (event) => {
          const prev = pointers.get(event.pointerId);
          if (!prev) return;
          const now = { x: event.clientX, y: event.clientY };
          pointers.set(event.pointerId, now);
          if (pointers.size === 2 && pinch) {
            const [a, b] = Array.from(pointers.values());
            z = clamp(pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), 1, 4);
          } else if (pointers.size === 1) {
            cx += now.x - prev.x;
            cy += now.y - prev.y;
          }
          apply();
        });
        const drop = (event) => { pointers.delete(event.pointerId); pinch = null; };
        stage.addEventListener('pointerup', drop);
        stage.addEventListener('pointercancel', drop);
        stage.addEventListener('wheel', (event) => {
          event.preventDefault();
          z = clamp(z * Math.exp(-event.deltaY * 0.0015), 1, 4);
          apply();
        }, { passive: false });
        zoom.addEventListener('input', () => { z = clamp(Number(zoom.value) / 100, 1, 4); apply(); });

        ok.addEventListener('click', () => {
          if (!source) return;
          const s = base() * z;
          const sw = fw / s;
          const sh = fh / s;
          const ix = iw / 2 - cx / s;
          const iy = ih / 2 - cy / s;
          const canvas = document.createElement('canvas');
          canvas.width = outW;
          canvas.height = outH;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#111';
          ctx.fillRect(0, 0, outW, outH);
          ctx.drawImage(source, ix - sw / 2, iy - sh / 2, sw, sh, 0, 0, outW, outH);
          const data = canvas.toDataURL('image/jpeg', circle ? 0.9 : 0.82);
          closeModal();
          finish(data);
        });
      }
    });
    const watch = new MutationObserver(() => {
      if (!document.body.contains(entry.node)) { watch.disconnect(); finish(null); }
    });
    watch.observe($('#modalLayer'), { childList: true });
  });
}
