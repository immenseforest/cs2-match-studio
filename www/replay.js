(function () {
  const state = {frames: [], events: [], bounds: null, index: 0, playing: false,
    fps: 8, speed: 1, last: 0, trails: new Map(), round: null};

  const colors = {2: "#f5b942", 3: "#4eb7ff"};
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function setup() {
    const canvas = $("replay-canvas");
    if (!canvas || canvas.dataset.ready) return;
    canvas.dataset.ready = "1";
    $("replay-play").onclick = () => { state.playing = !state.playing; $("replay-play").textContent = state.playing ? "Pause" : "Play"; state.last = 0; };
    $("replay-prev").onclick = () => seek(state.index - 1);
    $("replay-next").onclick = () => seek(state.index + 1);
    $("replay-speed").onchange = e => state.speed = Number(e.target.value);
    $("replay-seek").oninput = e => seek(Number(e.target.value));
    requestAnimationFrame(loop);
  }

  function seek(i) {
    state.index = Math.max(0, Math.min(state.frames.length - 1, i));
    state.trails.clear();
    const from = Math.max(0, state.index - state.fps * 2);
    for (let j = from; j <= state.index; j++) updateTrails(state.frames[j]);
    draw();
  }

  function updateTrails(frame) {
    if (!frame) return;
    frame.players.forEach(p => {
      const key = p.name, trail = state.trails.get(key) || [];
      trail.push([p.X, p.Y]);
      while (trail.length > state.fps * 2) trail.shift();
      state.trails.set(key, trail);
    });
  }

  function transform(x, y, width, height) {
    const b = state.bounds, pad = 34;
    const dx = Math.max(1, b.xmax - b.xmin), dy = Math.max(1, b.ymax - b.ymin);
    const scale = Math.min((width - 2*pad)/dx, (height - 2*pad)/dy);
    const ox = pad + ((width - 2*pad) - dx*scale)/2;
    const oy = pad + ((height - 2*pad) - dy*scale)/2;
    return [ox + (x-b.xmin)*scale, height - oy - (y-b.ymin)*scale];
  }

  function draw() {
    const canvas = $("replay-canvas"); if (!canvas || !state.frames.length) return;
    const dpr = window.devicePixelRatio || 1, rect = canvas.getBoundingClientRect();
    if (canvas.width !== Math.round(rect.width*dpr) || canvas.height !== Math.round(rect.height*dpr)) {
      canvas.width = Math.round(rect.width*dpr); canvas.height = Math.round(rect.height*dpr);
    }
    const ctx = canvas.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0);
    const w = rect.width, h = rect.height; ctx.fillStyle="#07111f"; ctx.fillRect(0,0,w,h);
    ctx.strokeStyle="#16263a"; ctx.lineWidth=1;
    for(let i=1;i<9;i++){ctx.beginPath();ctx.moveTo(i*w/9,0);ctx.lineTo(i*w/9,h);ctx.stroke();ctx.beginPath();ctx.moveTo(0,i*h/9);ctx.lineTo(w,i*h/9);ctx.stroke();}
    const frame = state.frames[state.index];
    state.trails.forEach((trail, name) => {
      const p = frame.players.find(x => x.name === name); if (!p || trail.length < 2) return;
      ctx.strokeStyle=colors[p.team_num] || "#8da2b8";ctx.globalAlpha=.35;ctx.lineWidth=2;ctx.beginPath();
      trail.forEach((xy,i)=>{const q=transform(xy[0],xy[1],w,h);i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]);});ctx.stroke();ctx.globalAlpha=1;
    });
    frame.players.forEach(p => {
      const q=transform(p.X,p.Y,w,h), alive=p.is_alive && p.health>0, c=alive?(colors[p.team_num]||"#8da2b8"):"#536273";
      const rad=(Number(p.yaw)||0)*Math.PI/180; ctx.strokeStyle=c;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(q[0],q[1]);ctx.lineTo(q[0]+18*Math.cos(rad),q[1]-18*Math.sin(rad));ctx.stroke();
      ctx.fillStyle=c;ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.beginPath();ctx.arc(q[0],q[1],alive?8:5,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.fillStyle="#f4f7fb";ctx.font="600 12px system-ui";ctx.fillText(p.name,q[0]+11,q[1]-8);
      if(alive){ctx.fillStyle="#101c2a";ctx.fillRect(q[0]+11,q[1]+1,42,4);ctx.fillStyle=p.health>40?"#6ce5b1":"#ff6b75";ctx.fillRect(q[0]+11,q[1]+1,42*Math.max(0,p.health)/100,4);}
    });
    $("replay-seek").value=state.index;
    $("replay-time").textContent=`${frame.time.toFixed(1)}s  •  tick ${frame.tick}`;
    const recent=state.events.filter(e=>e.tick<=frame.tick && e.tick>=frame.tick-320).slice(-8).reverse();
    $("event-feed").innerHTML=recent.map(e=>`<div class="event-row ${e.event_name==='player_death'?'kill':''}"><span>${esc(e.label)}</span><small>${esc(e.weapon)}</small></div>`).join("") || '<div class="empty-feed">No recent actions</div>';
  }

  function loop(ts) {
    setup();
    if(state.playing && state.frames.length && (!state.last || ts-state.last >= 1000/(state.fps*state.speed))){
      state.last=ts; if(state.index>=state.frames.length-1){state.playing=false;$("replay-play").textContent="Play";} else {state.index++;updateTrails(state.frames[state.index]);draw();}
    }
    requestAnimationFrame(loop);
  }

  Shiny.addCustomMessageHandler("loadReplay", data => {
    setup(); state.frames=data.frames||[];state.events=data.events||[];state.bounds=data.bounds;state.fps=data.fps||8;state.round=data.round;state.index=0;state.playing=false;state.trails.clear();
    $("replay-seek").max=Math.max(0,state.frames.length-1);$("replay-seek").value=0;$("replay-play").textContent="Play";
    updateTrails(state.frames[0]);draw();
  });
  window.addEventListener("resize", draw);
})();

