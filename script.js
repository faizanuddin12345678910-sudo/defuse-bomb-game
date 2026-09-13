// script.js — game logic with WebAudio synthesized sounds and mobile optimizations
(() => {
  // Configuration
  const START_SECONDS = 60;
  const wiresPool = ['red','green','blue'];
  const HOSTED_PATHS = ['assets/success.jpg','assets/success.png','assets/success.webp'];

  // DOM
  const bombEl = document.getElementById('bomb');
  const fuseEl = document.getElementById('fuse');
  const timeNum = document.getElementById('timeNum');
  const timeBar = document.getElementById('timeBar');
  const wiresArea = document.getElementById('wiresArea');
  const startBtn = document.getElementById('startBtn');
  const resetBtn = document.getElementById('resetBtn');
  const logEl = document.getElementById('log');
  const statusEl = document.getElementById('gameStatus');
  const overlay = document.getElementById('overlay');
  const overlayCard = document.getElementById('overlayCard');
  const boomCanvas = document.getElementById('boomCanvas');
  const chooseFileBtn = document.getElementById('chooseFileBtn');
  const fileInput = document.getElementById('fileInput');
  const urlInput = document.getElementById('urlInput');
  const pasteUrlBtn = document.getElementById('pasteUrlBtn');
  const clearImageBtn = document.getElementById('clearImageBtn');
  const imagePreviewText = document.getElementById('imagePreviewText');
  const settingsBtn = document.getElementById('settingsBtn');
  const muteBtn = document.getElementById('muteBtn');
  const volSlider = document.getElementById('volSlider');

  const IMAGE_KEY = 'defuse_success_image_dataurl_v2';
  let hostedImageUrl = null; // site-wide hosted image (if present)

  // State
  let timeLeft = START_SECONDS;
  let timerInterval = null;
  let running = false;
  let correctSequence = [];
  let cutSequence = [];

  // WebAudio
  let audioCtx = null;
  let masterGain = null;
  let tickIntervalId = null;
  let muted = false;

  // --- Audio helpers ---
  function initAudio(){
    if(audioCtx) return;
    try{
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = Number(volSlider.value || 0.9);
      masterGain.connect(audioCtx.destination);
      muted = false;
      updateMuteIcon();
    }catch(e){ console.warn('WebAudio not supported', e); }
  }

  function playBeep(frequency=880, time=0.06, type='sine', gain=0.07){
    if(!audioCtx || muted) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type; o.frequency.value = frequency;
    g.gain.value = gain;
    o.connect(g); g.connect(masterGain);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + time);
    o.stop(audioCtx.currentTime + time + 0.02);
  }

  function playCut(){ playBeep(1000,0.08,'square',0.08); }
  function playWrong(){ playBeep(180,0.18,'sawtooth',0.14); }
  function playSuccess(){ playBeep(1200,0.12,'sine',0.08); setTimeout(()=>playBeep(1500,0.08,'sine',0.06),90); }

  function startTick(){
    if(!audioCtx) initAudio();
    stopTick();
    tickIntervalId = setInterval(()=>{ playBeep(880,0.04,'sine',0.03); }, 1000);
  }
  function stopTick(){ if(tickIntervalId) { clearInterval(tickIntervalId); tickIntervalId=null; } }

  function playExplosion(){
    if(!audioCtx) initAudio();
    if(muted) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type='sine'; o.frequency.value=120;
    g.gain.value=0.8; g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.3);
    o.connect(g); g.connect(masterGain); o.start(); o.stop(audioCtx.currentTime + 1.3);
    const bufferSize=audioCtx.sampleRate*0.3;
    const buf = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for(let i=0;i<data.length;i++) data[i] = (Math.random()*2-1) * Math.exp(-i/bufferSize*5);
    const src = audioCtx.createBufferSource(); src.buffer = buf;
    const g2 = audioCtx.createGain(); g2.gain.value=0.6; g2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
    src.connect(g2); g2.connect(masterGain); src.start();
  }

  function updateMuteIcon(){ muteBtn.textContent = muted ? '🔈' : '🔊'; }

  // --- helpers ---
  function log(msg){ const t = new Date().toLocaleTimeString(); logEl.insertAdjacentHTML('afterbegin','<div>['+t+'] '+escapeHtml(msg)+'</div>'); }
  function escapeHtml(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  function getSavedImage(){ return localStorage.getItem(IMAGE_KEY); }
  function saveImageDataUrl(dataUrl){ try{ localStorage.setItem(IMAGE_KEY,dataUrl); updateImagePreview(); log('Saved success image.'); }catch(e){ alert('Could not save image: storage quota.'); } }
  function clearSavedImage(){ localStorage.removeItem(IMAGE_KEY); updateImagePreview(); log('Cleared success image.'); }

  function updateImagePreview(){ const d=getSavedImage(); imagePreviewText.textContent = d? 'A custom image is set and will be shown on success (local override).' : (hostedImageUrl ? 'A site-wide image is set (served to all players).' : 'No image chosen — will prompt on success.'); }

  // Try to detect a hosted image (site-wide) — this will be used for players if present
  async function detectHostedImage(){
    for(const p of HOSTED_PATHS){
      try{
        const resp = await fetch(p, { method: 'HEAD' });
        if(resp.ok){ hostedImageUrl = p; log('Detected hosted image: '+p); updateImagePreview(); return; }
      }catch(e){ /* ignore */ }
    }
    hostedImageUrl = null; updateImagePreview();
  }

  function pickSequence(){ const arr = wiresPool.slice(); for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; }

  function renderWires(){ wiresArea.innerHTML=''; wiresPool.forEach(color=>{
    const b = document.createElement('button'); b.className='wire '+color; b.dataset.color=color; b.innerText = color.toUpperCase();
    b.addEventListener('click', onWireClick, {passive:true}); b.addEventListener('touchstart', onWireTouch, {passive:true});
    wiresArea.appendChild(b);
  }); }

  function showSequenceHint(seq){ const hint = seq.map(s=>s[0].toUpperCase()).join(' • '); document.getElementById('sequenceHint').textContent = 'Sequence: '+hint; }

  function onWireTouch(e){ e.preventDefault(); onWireClick(e); }

  function onWireClick(e){ if(!running) return; const btn = e.currentTarget; if(btn.classList.contains('cut')) return; const color = btn.dataset.color; cutSequence.push(color); btn.classList.add('cut'); log('Cut '+color+' wire.'); if(!muted) playCut(); checkSequenceAfterCut(color); }

  function checkSequenceAfterCut(latest){ const expected = correctSequence[cutSequence.length-1]; if(latest !== expected){ log('Wrong wire! -10s penalty.'); shakeBomb(); timeLeft = Math.max(0,timeLeft-10); updateTimerDisplay(); if(!muted) playWrong(); if(timeLeft<=0){ explode(); } } else { if(cutSequence.length===correctSequence.length){ defuse(); } else { const rem = correctSequence.length - cutSequence.length; statusEl.textContent = `${rem} wire(s) left...`; } } }

  function startTimer(){ stopTimer(); timerInterval = setInterval(()=>{ timeLeft--; updateTimerDisplay(); if(timeLeft<=0){ clearInterval(timerInterval); explode(); } },1000); }
  function stopTimer(){ if(timerInterval){ clearInterval(timerInterval); timerInterval=null; } }
  function updateTimerDisplay(){ timeNum.textContent = timeLeft; const pct = Math.max(0, (timeLeft/START_SECONDS)*100); timeBar.style.width = pct + '%'; }

  function startGame(){ if(running) return; running=true; timeLeft = START_SECONDS; updateTimerDisplay(); correctSequence = pickSequence(); cutSequence = []; renderWires(); showSequenceHint(correctSequence); statusEl.textContent = 'Defuse the bomb — cut wires in order.'; log('Game started. You have '+START_SECONDS+' seconds.'); startTimer(); bombEl.classList.remove('shake'); fuseEl.classList.add('fuse-anim'); if(!muted) startTick(); }

  function resetGame(){ stopTimer(); stopTick(); running=false; timeLeft=START_SECONDS; updateTimerDisplay(); renderWires(); correctSequence=[]; cutSequence=[]; statusEl.textContent='Waiting — press Start'; log('Game reset.'); bombEl.classList.remove('shake'); fuseEl.classList.remove('fuse-anim'); }

  function defuse(){ stopTimer(); stopTick(); running=false; fuseEl.classList.remove('fuse-anim'); statusEl.textContent='Defused! Showing image...'; log('Bomb defused — success!'); if(!muted) playSuccess(); // show hosted image first, then local, then prompt
    if(hostedImageUrl){ showSuccessImage(hostedImageUrl); } else { const saved = getSavedImage(); if(saved){ showSuccessImage(saved); } else { askForImageFile().then(dataUrl=>{ if(dataUrl){ saveImageDataUrl(dataUrl); showSuccessImage(dataUrl); } else { statusEl.textContent='No image chosen. Defused.'; } }); } }
  }

  function explode(){ stopTimer(); stopTick(); running=false; statusEl.textContent='BOOM! The bomb exploded.'; log('Time ran out — BOOM!'); fuseEl.classList.remove('fuse-anim'); bombEl.classList.add('shake'); if(!muted) playExplosion(); runBoomAnimation().then(()=>{ showOverlayBoom(); }); }

  function shakeBomb(){ bombEl.classList.add('shake'); setTimeout(()=>bombEl.classList.remove('shake'),420); }

  function showOverlay(html){ overlayCard.innerHTML = html; overlay.classList.remove('hidden'); overlay.setAttribute('aria-hidden','false'); }
  function hideOverlay(){ overlay.classList.add('hidden'); overlay.setAttribute('aria-hidden','true'); }

  function showOverlayBoom(){ const html = `<div style="text-align:center"><div style="font-weight:800;font-size:22px;color:var(--danger);margin-bottom:8px">BOOM!</div><div class="small muted" style="margin-bottom:12px">The bomb exploded. Try again.</div><div style="display:flex;gap:8px;justify-content:center"><button id="retryBtn" class="btn">Retry</button></div></div>`; showOverlay(html); document.getElementById('retryBtn').addEventListener('click', ()=>{ hideOverlay(); resetGame(); }); }

  function showSuccessImage(dataUrl){ const html = `<div style="text-align:center"><div style="font-weight:800;font-size:22px;color:var(--success);margin-bottom:8px">DEFUSED!</div><div class="small muted" style="margin-bottom:12px">Here is your image.</div><img src="${dataUrl}" class="success-image" style="max-width:100%;max-height:70vh;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,0.6)" alt="Success image"/><div style="height:12px"></div><div style="display:flex;gap:8px;justify-content:center;margin-top:12px"><button id="closeImgBtn" class="btn">Close</button><button id="keepPlayingBtn" class="btn">Play Again</button></div></div>`; showOverlay(html); document.getElementById('closeImgBtn').addEventListener('click', ()=>{ hideOverlay(); resetGame(); }); document.getElementById('keepPlayingBtn').addEventListener('click', ()=>{ hideOverlay(); resetGame(); startGame(); }); }

  function askForImageFile(){ return new Promise(resolve=>{ const chooser = document.createElement('input'); chooser.type='file'; chooser.accept='image/*'; chooser.onchange = e=>{ const f = e.target.files && e.target.files[0]; if(!f){ resolve(null); return; } const fr = new FileReader(); fr.onload = evt=> resolve(evt.target.result); fr.readAsDataURL(f); }; chooser.click(); }); }

  async function fetchImageAsDataUrl(url){ try{ const resp = await fetch(url); if(!resp.ok) return null; const blob = await resp.blob(); return await new Promise(res=>{ const fr=new FileReader(); fr.onload = e=> res(e.target.result); fr.readAsDataURL(blob); }); }catch(e){ return null; } }

  // Boom canvas animation
  function runBoomAnimation(){ return new Promise(resolve=>{
    const canvas = boomCanvas; const dpr = devicePixelRatio || 1; canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px'; const ctx = canvas.getContext('2d'); ctx.scale(dpr,dpr); canvas.classList.remove('hidden');
    const particles = []; const cx = innerWidth/2, cy = innerHeight/2; const colors = ['#ffad5a','#ff6b6b','#ffd76b','#ffffff','#ff3a3a','#ffa07a'];
    for(let i=0;i<180;i++){ particles.push({ x:cx, y:cy, vx:(Math.random()-0.5)*12*(1+Math.random()*3), vy:(Math.random()-0.5)*12*(1+Math.random()*3), r:2+Math.random()*6, life:40+Math.random()*40, color:colors[Math.floor(Math.random()*colors.length)] }); }
    let frame=0; function step(){ frame++; ctx.clearRect(0,0,innerWidth,innerHeight); particles.forEach(p=>{ p.x+=p.vx; p.y+=p.vy + 0.6*(frame/60); p.vx*=0.98; p.vy*=0.98; p.life-=1; ctx.beginPath(); ctx.fillStyle=p.color; ctx.globalAlpha = Math.max(0,p.life/80); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill(); }); if(frame<10){ ctx.fillStyle='rgba(255,240,200,'+(0.16*(1-frame/10))+')'; ctx.fillRect(0,0,innerWidth,innerHeight); } if(frame<140){ requestAnimationFrame(step); } else { ctx.clearRect(0,0,innerWidth,innerHeight); canvas.classList.add('hidden'); resolve(); } }
    step();
  }); }

  // Settings overlay
  settingsBtn.addEventListener('click', ()=>{
    const html = `<div style="text-align:left"><div style="font-weight:800;font-size:18px;margin-bottom:8px">Settings</div><div class="small muted" style="margin-bottom:8px">Choose an image to show on success. Images are stored locally in your browser. To set a site-wide image (visible to all users) use <a href="/defuse-bomb-game/admin.html">Admin page</a>.</div><div style="display:flex;gap:8px;margin-bottom:8px"><button id="sChoose" class="btn">Choose Image</button><button id="sClear" class="ghost">Clear Image</button></div><div style="margin-top:8px"><label class="small muted">Or paste an image URL (CORS may block fetch):</label><input id="sUrl" placeholder="https://..." style="width:100%;padding:8px;margin-top:6px;border-radius:6px;background:transparent;border:1px solid rgba(255,255,255,0.04)"><div style="display:flex;gap:8px;margin-top:6px"><button id="sSetUrl" class="btn">Set URL</button><button id="sClose" class="ghost">Close</button></div></div></div>`;
    showOverlay(html);
    document.getElementById('sChoose').addEventListener('click', ()=> fileInput.click());
    document.getElementById('sClear').addEventListener('click', ()=>{ clearSavedImage(); hideOverlay(); });
    document.getElementById('sSetUrl').addEventListener('click', ()=>{
      const u = document.getElementById('sUrl').value.trim(); if(!u) return alert('Enter URL'); fetchImageAsDataUrl(u).then(d=>{ if(d){ saveImageDataUrl(d); hideOverlay(); } else alert('Could not fetch image (CORS or network).'); });
    });
    document.getElementById('sClose').addEventListener('click', ()=> hideOverlay());
  });

  // File input handlers
  chooseFileBtn.addEventListener('click', ()=> fileInput.click());
  fileInput.addEventListener('change', e=>{ const f = e.target.files && e.target.files[0]; if(!f) return; const fr = new FileReader(); fr.onload = evt=> saveImageDataUrl(evt.target.result); fr.readAsDataURL(f); });
  pasteUrlBtn.addEventListener('click', ()=>{ const url = urlInput.value.trim(); if(!url){ alert('Paste an image URL'); return; } fetchImageAsDataUrl(url).then(dataUrl=>{ if(dataUrl){ saveImageDataUrl(dataUrl); } else alert('Could not fetch image (CORS or network).'); }); });
  clearImageBtn.addEventListener('click', ()=>{ if(confirm('Clear saved success image?')) clearSavedImage(); });

  // Mute and volume
  muteBtn.addEventListener('click', ()=>{ initAudio(); muted = !muted; if(masterGain) masterGain.gain.value = muted ? 0 : Number(volSlider.value || 0.9); updateMuteIcon(); });
  volSlider.addEventListener('input', ()=>{ initAudio(); if(masterGain && !muted) masterGain.gain.value = Number(volSlider.value); });

  // Buttons
  startBtn.addEventListener('click', ()=>{ initAudio(); startGame(); });
  resetBtn.addEventListener('click', ()=> resetGame());

  // Keyboard shortcuts
  window.addEventListener('keydown', e=>{ if(e.key==='Enter' && !running) startGame(); if(e.key==='Escape') hideOverlay(); });

  // Init
  async function init(){ renderWires(); resetGame(); updateImagePreview(); await detectHostedImage(); log('Ready — tap Start.'); }
  init();

  // expose for console debugging
  window.DefuseGame = { startGame, resetGame, saveImageDataUrl, clearSavedImage, getSavedImage: getSavedImage };
})();
