(function () {
  const state = {
    frames: [], events: [], bounds: null, map: null, mapImage: null,
    lowerImage: null, index: 0, playing: false, fps: 8, speed: 1,
    last: 0, trails: new Map(), round: null, level: "auto"
  };

  const colors = {2: "#ffc857", 3: "#4cc9ff"};
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function setup() {
    const canvas = $("replay-canvas");
    if (!canvas || canvas.dataset.ready) return;
    canvas.dataset.ready = "1";
    $("replay-play").onclick = () => {
      if (!state.frames.length) return;
      state.playing = !state.playing;
      $("replay-play").textContent = state.playing ? "Pause" : "Play";
      state.last = 0;
    };
    $("replay-prev").onclick = () => seek(state.index - 1);
    $("replay-next").onclick = () => seek(state.index + 1);
    $("replay-speed").onchange = e => state.speed = Number(e.target.value);
    $("replay-level").onchange = e => { state.level = e.target.value; draw(); };
    $("replay-seek").oninput = e => seek(Number(e.target.value));
    draw();
    requestAnimationFrame(loop);
  }

  function seek(i) {
    if (!state.frames.length) return;
    state.index = Math.max(0, Math.min(state.frames.length - 1, i));
    state.trails.clear();
    const from = Math.max(0, state.index - state.fps * 2);
    for (let j = from; j <= state.index; j++) updateTrails(state.frames[j]);
    draw();
  }

  function updateTrails(frame) {
    if (!frame) return;
    frame.players.forEach(p => {
      const trail = state.trails.get(p.name) || [];
      trail.push([p.X, p.Y, p.Z]);
      while (trail.length > state.fps * 2) trail.shift();
      state.trails.set(p.name, trail);
    });
  }

  function mapBox(width, height) {
    const size = Math.min(width, height) - 20;
    return {x: (width - size) / 2, y: (height - size) / 2, size};
  }

  function transform(x, y, width, height) {
    if (state.map && Number.isFinite(Number(state.map.scale))) {
      const box = mapBox(width, height);
      const px = (Number(x) - Number(state.map.pos_x)) / Number(state.map.scale);
      const py = (Number(state.map.pos_y) - Number(y)) / Number(state.map.scale);
      return [box.x + px * box.size / 1024, box.y + py * box.size / 1024];
    }
    const b = state.bounds, pad = 34;
    if (!b) return [width / 2, height / 2];
    const dx = Math.max(1, b.xmax - b.xmin), dy = Math.max(1, b.ymax - b.ymin);
    const scale = Math.min((width - 2*pad)/dx, (height - 2*pad)/dy);
    const ox = pad + ((width - 2*pad) - dx*scale)/2;
    const oy = pad + ((height - 2*pad) - dy*scale)/2;
    return [ox + (x-b.xmin)*scale, height - oy - (y-b.ymin)*scale];
  }

  function useLowerLevel(frame) {
    if (!state.lowerImage) return false;
    if (state.level === "lower") return true;
    if (state.level === "upper") return false;
    const threshold = Number(state.map.lower_level_max_units);
    const alive = frame.players.filter(p => p.is_alive && Number.isFinite(Number(p.Z)));
    if (!alive.length || !Number.isFinite(threshold)) return false;
    return alive.filter(p => Number(p.Z) <= threshold).length > alive.length / 2;
  }

  function drawEmpty(ctx, width, height) {
    ctx.fillStyle = "#07101b";
    ctx.fillRect(0, 0, width, height);
    const box = mapBox(width, height);
    ctx.strokeStyle = "#35506d";
    ctx.lineWidth = 1;
    ctx.setLineDash([7, 8]);
    ctx.strokeRect(box.x + 18, box.y + 18, box.size - 36, box.size - 36);
    ctx.setLineDash([]);
    ctx.textAlign = "center";
    ctx.fillStyle = "#f7f9fc";
    ctx.font = "700 18px system-ui";
    ctx.fillText("Tactical replay", width / 2, height / 2 - 8);
    ctx.fillStyle = "#bdcad9";
    ctx.font = "14px system-ui";
    ctx.fillText("Upload and parse a demo to load the calibrated map", width / 2, height / 2 + 20);
    ctx.textAlign = "start";
  }

  function drawBackground(ctx, width, height, frame) {
    ctx.fillStyle = "#07101b";
    ctx.fillRect(0, 0, width, height);
    const chosen = useLowerLevel(frame) ? state.lowerImage : state.mapImage;
    if (chosen && chosen.complete && chosen.naturalWidth) {
      const box = mapBox(width, height);
      ctx.drawImage(chosen, box.x, box.y, box.size, box.size);
      ctx.fillStyle = "rgba(4, 10, 18, .14)";
      ctx.fillRect(box.x, box.y, box.size, box.size);
      ctx.strokeStyle = "#4d6c8d";
      ctx.strokeRect(box.x, box.y, box.size, box.size);
      return;
    }
    ctx.strokeStyle = "#29445f";
    ctx.lineWidth = 1;
    for (let i=1; i<9; i++) {
      ctx.beginPath(); ctx.moveTo(i*width/9,0); ctx.lineTo(i*width/9,height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0,i*height/9); ctx.lineTo(width,i*height/9); ctx.stroke();
    }
  }

  function labelPlayer(ctx, p, x, y) {
    const name = String(p.name || "Player");
    ctx.font = "700 12px system-ui";
    const tw = ctx.measureText(name).width;
    ctx.fillStyle = "rgba(3, 8, 15, .86)";
    ctx.fillRect(x + 10, y - 19, tw + 10, 18);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(name, x + 15, y - 6);
  }

  function draw() {
    const canvas = $("replay-canvas");
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1, rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (canvas.width !== Math.round(rect.width*dpr) || canvas.height !== Math.round(rect.height*dpr)) {
      canvas.width = Math.round(rect.width*dpr);
      canvas.height = Math.round(rect.height*dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const w = rect.width, h = rect.height;
    if (!state.frames.length) { drawEmpty(ctx, w, h); return; }

    const frame = state.frames[state.index];
    drawBackground(ctx, w, h, frame);
    state.trails.forEach((trail, name) => {
      const p = frame.players.find(x => x.name === name);
      if (!p || trail.length < 2) return;
      ctx.strokeStyle = colors[p.team_num] || "#bdcad9";
      ctx.globalAlpha = .58;
      ctx.lineWidth = 3;
      ctx.beginPath();
      trail.forEach((xyz,i) => { const q=transform(xyz[0],xyz[1],w,h); i ? ctx.lineTo(q[0],q[1]) : ctx.moveTo(q[0],q[1]); });
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
    frame.players.forEach(p => {
      const q = transform(p.X,p.Y,w,h), alive = p.is_alive && p.health > 0;
      const c = alive ? (colors[p.team_num] || "#bdcad9") : "#8796a8";
      const rad = (Number(p.yaw)||0)*Math.PI/180;
      ctx.strokeStyle = "rgba(3,8,15,.9)"; ctx.lineWidth=5; ctx.beginPath(); ctx.moveTo(q[0],q[1]); ctx.lineTo(q[0]+20*Math.cos(rad),q[1]-20*Math.sin(rad)); ctx.stroke();
      ctx.strokeStyle = c; ctx.lineWidth=2.5; ctx.beginPath(); ctx.moveTo(q[0],q[1]); ctx.lineTo(q[0]+20*Math.cos(rad),q[1]-20*Math.sin(rad)); ctx.stroke();
      ctx.fillStyle=c; ctx.strokeStyle="#ffffff"; ctx.lineWidth=2.5; ctx.beginPath(); ctx.arc(q[0],q[1],alive?9:6,0,Math.PI*2); ctx.fill(); ctx.stroke();
      labelPlayer(ctx,p,q[0],q[1]);
      if (alive) {
        ctx.fillStyle="#08111f"; ctx.fillRect(q[0]+11,q[1]+2,46,6);
        ctx.fillStyle=p.health>40?"#5ee7b2":"#ff7b88"; ctx.fillRect(q[0]+12,q[1]+3,44*Math.max(0,p.health)/100,4);
      }
    });

    $("replay-seek").value=state.index;
    $("replay-time").textContent=`${frame.time.toFixed(1)}s  •  tick ${frame.tick}`;
    const lower = useLowerLevel(frame);
    $("replay-map-badge").textContent = `${state.map?.name || "Map"}${state.lowerImage ? ` • ${lower ? "Lower" : "Upper"}` : ""}`;
    const recent=state.events.filter(e=>e.tick<=frame.tick && e.tick>=frame.tick-320).slice(-8).reverse();
    $("event-feed").innerHTML=recent.map(e=>`<div class="event-row ${e.event_name==='player_death'?'kill':''}"><span>${esc(e.label)}</span><small>${esc(e.weapon)}</small></div>`).join("") || '<div class="empty-feed">No recent actions</div>';
  }

  function loadImage(url, key) {
    state[key] = null;
    if (!url) return;
    const img = new Image();
    img.onload = draw;
    img.onerror = () => { state[key] = null; draw(); };
    img.src = url;
    state[key] = img;
  }

  function loop(ts) {
    setup();
    if (state.playing && state.frames.length && (!state.last || ts-state.last >= 1000/(state.fps*state.speed))) {
      state.last=ts;
      if (state.index>=state.frames.length-1) { state.playing=false; $("replay-play").textContent="Play"; }
      else { state.index++; updateTrails(state.frames[state.index]); draw(); }
    }
    requestAnimationFrame(loop);
  }

  Shiny.addCustomMessageHandler("loadReplay", data => {
    setup();
    state.frames=data.frames||[]; state.events=data.events||[]; state.bounds=data.bounds;
    state.map=data.map||null; state.fps=data.fps||8; state.round=data.round;
    state.index=0; state.playing=false; state.trails.clear(); state.level="auto";
    $("replay-seek").max=Math.max(0,state.frames.length-1); $("replay-seek").value=0;
    $("replay-play").textContent="Play"; $("replay-level").value="auto";
    loadImage(state.map?.image, "mapImage");
    loadImage(state.map?.lower_image, "lowerImage");
    $("replay-level").style.display = state.map?.lower_image ? "inline-block" : "none";
    $("replay-map-badge").textContent = state.map?.image ? state.map.name : `${state.map?.name || "Map"} • coordinate view`;
    updateTrails(state.frames[0]);
    draw();
  });
  window.addEventListener("resize", draw);
})();
