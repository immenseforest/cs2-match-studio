(function () {
  const state = {
    frames: [], events: [], bounds: null, map: null, mapImage: null,
    lowerImage: null, index: 0, playing: false, fps: 8, speed: 1,
    last: 0, trails: new Map(), round: null, level: "auto",
    zoom: 1, panX: 0, panY: 0, drag: null
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
    $("replay-zoom-out").onclick = () => setZoom(state.zoom - .25);
    $("replay-zoom-in").onclick = () => setZoom(state.zoom + .25);
    $("replay-zoom-reset").onclick = () => { state.zoom=1; state.panX=0; state.panY=0; updateZoomUI(); draw(); };
    canvas.addEventListener("wheel", event => {
      if (!state.frames.length) return;
      event.preventDefault();
      const rect=canvas.getBoundingClientRect();
      setZoom(state.zoom+(event.deltaY<0?.2:-.2),event.clientX-rect.left,event.clientY-rect.top);
    },{passive:false});
    canvas.addEventListener("pointerdown", event => {
      if(state.zoom<=1)return;
      state.drag={x:event.clientX,y:event.clientY,panX:state.panX,panY:state.panY};
      canvas.setPointerCapture(event.pointerId);canvas.classList.add("is-panning");
    });
    canvas.addEventListener("pointermove", event => {
      if(!state.drag)return;
      state.panX=state.drag.panX+event.clientX-state.drag.x;state.panY=state.drag.panY+event.clientY-state.drag.y;
      constrainPan();draw();
    });
    const stopPan=()=>{state.drag=null;canvas.classList.remove("is-panning");};
    canvas.addEventListener("pointerup",stopPan);canvas.addEventListener("pointercancel",stopPan);
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

  function viewPoint(point,width,height) {
    return [width/2+(point[0]-width/2)*state.zoom+state.panX,height/2+(point[1]-height/2)*state.zoom+state.panY];
  }

  function constrainPan() {
    const canvas=$("replay-canvas"),rect=canvas?.getBoundingClientRect();if(!rect)return;
    const limit=Math.max(0,(Math.min(rect.width,rect.height)-20)*(state.zoom-1)/2+80);
    state.panX=Math.max(-limit,Math.min(limit,state.panX));state.panY=Math.max(-limit,Math.min(limit,state.panY));
  }

  function updateZoomUI() {
    const button=$("replay-zoom-reset");if(button)button.textContent=`${Math.round(state.zoom*100)}%`;
    const canvas=$("replay-canvas");if(canvas)canvas.classList.toggle("can-pan",state.zoom>1);
  }

  function setZoom(value,anchorX=null,anchorY=null) {
    const canvas=$("replay-canvas"),rect=canvas?.getBoundingClientRect();if(!rect)return;
    const next=Math.max(1,Math.min(3,Math.round(value*100)/100));
    const x=anchorX??rect.width/2,y=anchorY??rect.height/2,ratio=next/state.zoom;
    state.panX=x-rect.width/2-(x-rect.width/2-state.panX)*ratio;
    state.panY=y-rect.height/2-(y-rect.height/2-state.panY)*ratio;
    state.zoom=next;if(next===1){state.panX=0;state.panY=0;}constrainPan();updateZoomUI();draw();
  }

  function transform(x, y, width, height) {
    if (state.map && Number.isFinite(Number(state.map.scale))) {
      const box = mapBox(width, height);
      const px = (Number(x) - Number(state.map.pos_x)) / Number(state.map.scale);
      const py = (Number(state.map.pos_y) - Number(y)) / Number(state.map.scale);
      return viewPoint([box.x + px * box.size / 1024, box.y + py * box.size / 1024],width,height);
    }
    const b = state.bounds, pad = 34;
    if (!b) return [width / 2, height / 2];
    const dx = Math.max(1, b.xmax - b.xmin), dy = Math.max(1, b.ymax - b.ymin);
    const scale = Math.min((width - 2*pad)/dx, (height - 2*pad)/dy);
    const ox = pad + ((width - 2*pad) - dx*scale)/2;
    const oy = pad + ((height - 2*pad) - dy*scale)/2;
    return viewPoint([ox + (x-b.xmin)*scale, height - oy - (y-b.ymin)*scale],width,height);
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

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width/2, height/2);
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.lineTo(x+width-r,y); ctx.quadraticCurveTo(x+width,y,x+width,y+r);
    ctx.lineTo(x+width,y+height-r); ctx.quadraticCurveTo(x+width,y+height,x+width-r,y+height);
    ctx.lineTo(x+r,y+height); ctx.quadraticCurveTo(x,y+height,x,y+height-r);
    ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
  }

  function drawEmpty(ctx, width, height) {
    ctx.fillStyle = "#050505"; ctx.fillRect(0, 0, width, height);
    const box = mapBox(width, height);
    ctx.strokeStyle = "#444444"; ctx.lineWidth = 1; ctx.setLineDash([7, 8]);
    ctx.strokeRect(box.x + 18, box.y + 18, box.size - 36, box.size - 36); ctx.setLineDash([]);
    ctx.textAlign = "center"; ctx.fillStyle = "#f7f9fc"; ctx.font = "700 18px system-ui";
    ctx.fillText("Tactical replay", width / 2, height / 2 - 8);
    ctx.fillStyle = "#bdbdbd"; ctx.font = "14px system-ui";
    ctx.fillText("Upload and parse a demo to load the calibrated map", width / 2, height / 2 + 20);
    ctx.textAlign = "start";
  }

  function drawBackground(ctx, width, height, frame) {
    ctx.fillStyle = "#050505"; ctx.fillRect(0, 0, width, height);
    const chosen = useLowerLevel(frame) ? state.lowerImage : state.mapImage;
    if (chosen && chosen.complete && chosen.naturalWidth) {
      const box = mapBox(width, height);
      const topLeft=viewPoint([box.x,box.y],width,height),size=box.size*state.zoom;
      ctx.drawImage(chosen, topLeft[0], topLeft[1], size, size);
      ctx.fillStyle = "rgba(0, 0, 0, .14)"; ctx.fillRect(topLeft[0], topLeft[1], size, size);
      ctx.strokeStyle = "#616161"; ctx.strokeRect(topLeft[0], topLeft[1], size, size);
      return;
    }
    ctx.strokeStyle = "#353535"; ctx.lineWidth = 1;
    for (let i=1; i<9; i++) {
      const vx1=viewPoint([i*width/9,0],width,height),vx2=viewPoint([i*width/9,height],width,height);
      const hy1=viewPoint([0,i*height/9],width,height),hy2=viewPoint([width,i*height/9],width,height);
      ctx.beginPath();ctx.moveTo(vx1[0],vx1[1]);ctx.lineTo(vx2[0],vx2[1]);ctx.stroke();
      ctx.beginPath();ctx.moveTo(hy1[0],hy1[1]);ctx.lineTo(hy2[0],hy2[1]);ctx.stroke();
    }
  }

  function cleanWeapon(value) {
    const raw = String(value || "").replace(/^weapon_/, "").replaceAll("_", " ");
    const names = {hegrenade:"HE grenade", flashbang:"flashbang", smokegrenade:"smoke", molotov:"Molotov", incgrenade:"incendiary"};
    return names[raw] || raw || "weapon";
  }

  function actionMeta(event) {
    const name = event.event_name;
    const weapon = cleanWeapon(event.weapon);
    const actor = event.actor || "Player";
    const target = event.target || "player";
    if (name === "weapon_fire") {
      const utility = /grenade|flashbang|molotov|incgrenade|decoy/.test(weapon);
      if (utility) return {tag:"THROW", kind:"throw", color:"#c4a7ff", duration:56, actor, verb:`threw ${weapon}`};
      const melee = /knife|bayonet/.test(weapon);
      return {tag:melee?"SWING":"SHOT", kind:"shot", color:"#fff176", duration:24, actor, verb:`${melee?"swung":"fired"} ${weapon}`};
    }
    if (name === "grenade_thrown") return {tag:"THROW", kind:"throw", color:"#c4a7ff", duration:56, actor, verb:`threw ${weapon}`};
    if (name === "hegrenade_detonate") return {tag:"HE", kind:"he", color:"#ff8a65", duration:96, actor, verb:"HE grenade exploded"};
    if (name === "flashbang_detonate") return {tag:"FLASH", kind:"flash", color:"#fff7b2", duration:72, actor, verb:"flashbang popped"};
    if (name === "smokegrenade_detonate") return {tag:"SMOKE", kind:"smoke", color:"#b8c4d1", duration:112, actor, verb:"smoke deployed"};
    if (name === "inferno_startburn") return {tag:"FIRE", kind:"fire", color:"#ff9f43", duration:112, actor, verb:"fire started"};
    if (name === "player_hurt") return {tag:"HIT", kind:"hit", color:"#ff7b88", duration:40, actor, verb:`hit ${target}${Number(event.damage)?` for ${Number(event.damage)}`:""}`};
    if (name === "player_death") return {tag:event.headshot?"HS":"KILL", kind:"kill", color:"#ff5265", duration:104, actor, verb:`eliminated ${target} with ${weapon}`};
    if (name === "player_blind") return {tag:"BLIND", kind:"flash", color:"#fff7b2", duration:64, actor, verb:`flashed ${target}`};
    if (name === "bomb_planted") return {tag:"PLANT", kind:"bomb", color:"#ffb74d", duration:128, actor, verb:"planted the bomb"};
    if (name === "bomb_defused") return {tag:"DEFUSE", kind:"bomb", color:"#5ee7b2", duration:128, actor, verb:"defused the bomb"};
    if (name === "bomb_exploded") return {tag:"BOOM", kind:"bomb", color:"#ff6b45", duration:160, actor, verb:"bomb exploded"};
    if (name === "bomb_dropped") return {tag:"DROP", kind:"bomb", color:"#ffb74d", duration:72, actor, verb:"dropped the bomb"};
    if (name === "bomb_pickup") return {tag:"BOMB", kind:"bomb", color:"#ffb74d", duration:56, actor, verb:"picked up the bomb"};
    return {tag:"ACT", kind:"other", color:"#bdcad9", duration:48, actor, verb:String(event.label || name).replaceAll("_", " ")};
  }

  function eventPoint(event, frame, width, height) {
    const targetFirst = event.event_name === "player_hurt" || event.event_name === "player_death" || event.event_name === "player_blind";
    const playerName = targetFirst ? event.target : event.actor;
    const player = frame.players.find(p => p.name === playerName);
    if (player) return transform(player.X, player.Y, width, height);
    if (Number.isFinite(Number(event.x)) && Number.isFinite(Number(event.y))) return transform(event.x, event.y, width, height);
    return null;
  }

  function drawActions(ctx, frame, width, height) {
    const offsets = new Map();
    const candidates=state.events.map(event=>({event,meta:actionMeta(event),age:frame.tick-Number(event.tick)})).filter(item=>item.age>=0&&item.age<=item.meta.duration);
    const hasImpact=candidates.some(item=>item.meta.tag==="HIT"||item.meta.tag==="KILL"||item.meta.tag==="HS");
    const priority={BOOM:9,PLANT:9,DEFUSE:9,KILL:8,HS:8,HE:7,FLASH:7,SMOKE:7,FIRE:7,THROW:6,SHOT:5,HIT:4,SWING:1};
    const seen=new Set();
    candidates.sort((a,b)=>(priority[b.meta.tag]||2)-(priority[a.meta.tag]||2)||a.age-b.age).slice(0,12).forEach(({event,meta,age}) => {
      if(meta.tag==="SWING"&&hasImpact)return;
      const signature=`${meta.actor}:${meta.tag}`;if(seen.has(signature))return;seen.add(signature);
      const point = eventPoint(event, frame, width, height);
      if (!point) return;
      const fade = 1 - age / meta.duration;
      const radius = 13 + (1-fade)*18;
      ctx.globalAlpha = .25 + fade*.65;
      ctx.strokeStyle = meta.color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(point[0], point[1], radius, 0, Math.PI*2); ctx.stroke();
      ctx.globalAlpha = 1;
      const key = `${Math.round(point[0]/24)}:${Math.round(point[1]/24)}`;
      const offset = offsets.get(key) || 0; offsets.set(key, offset + 1);
      ctx.font = "800 10px system-ui";
      const textWidth = ctx.measureText(meta.tag).width;
      const x = point[0] - (textWidth+12)/2, y = point[1] + 14 + offset*20;
      roundedRect(ctx,x,y,textWidth+12,17,5); ctx.fillStyle="rgba(5,5,5,.92)"; ctx.fill();
      ctx.strokeStyle=meta.color; ctx.lineWidth=1; ctx.stroke();
      ctx.fillStyle=meta.color; ctx.fillText(meta.tag,x+6,y+12);
    });
  }

  function overlapArea(a,b) {
    const width=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x));
    const height=Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
    return width*height;
  }

  function shortName(value) {
    const name=String(value || "Player");
    return name.length > 13 ? `${name.slice(0,12)}…` : name;
  }

  function drawPlayerLabels(ctx, players, width, height) {
    const placed=[];
    const items=players.filter(p=>p.is_alive && p.health>0).map(p=>({...p, point:transform(p.X,p.Y,width,height)})).sort((a,b)=>a.point[1]-b.point[1]);
    items.forEach(p=>{
      const name=shortName(p.name), hp=String(Math.max(0,Math.round(Number(p.health)||0)));
      ctx.font="700 11px system-ui";
      const nameWidth=ctx.measureText(name).width;
      ctx.font="800 10px system-ui";
      const hpWidth=ctx.measureText(hp).width;
      const box={w:nameWidth+hpWidth+27,h:21};
      const rightFirst=Number(p.team_num)===3;
      const sideOffsets=rightFirst ? [14,-box.w-14] : [-box.w-14,14];
      const candidates=[];
      [-30,-7,16,-53,39].forEach(dy=>sideOffsets.forEach(dx=>candidates.push({x:p.point[0]+dx,y:p.point[1]+dy,w:box.w,h:box.h})));
      let best=null, bestCost=Infinity;
      candidates.forEach(candidate=>{
        const clamped={...candidate,x:Math.max(4,Math.min(width-candidate.w-4,candidate.x)),y:Math.max(4,Math.min(height-candidate.h-4,candidate.y))};
        const overlap=placed.reduce((sum,other)=>sum+overlapArea(clamped,other),0);
        const cost=overlap*1000+Math.abs(clamped.x-candidate.x)*20+Math.abs(clamped.y-candidate.y)*20+Math.hypot(clamped.x-p.point[0],clamped.y-p.point[1]);
        if(cost<bestCost){best=clamped;bestCost=cost;}
      });
      placed.push(best);
      const color=colors[p.team_num]||"#bdcad9";
      const anchorX=best.x>p.point[0]?best.x:best.x+best.w;
      const anchorY=Math.max(best.y+4,Math.min(best.y+best.h-4,p.point[1]));
      ctx.strokeStyle="rgba(225,225,225,.3)";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(p.point[0],p.point[1]);ctx.lineTo(anchorX,anchorY);ctx.stroke();
      roundedRect(ctx,best.x,best.y,best.w,best.h,6);ctx.fillStyle="rgba(5,5,5,.56)";ctx.fill();ctx.globalAlpha=.68;ctx.strokeStyle=color;ctx.lineWidth=1.25;ctx.stroke();ctx.globalAlpha=1;
      ctx.globalAlpha=.72;ctx.fillStyle=color;ctx.fillRect(best.x+5,best.y+5,3,best.h-10);ctx.globalAlpha=1;
      ctx.font="700 11px system-ui";ctx.fillStyle="rgba(255,255,255,.8)";ctx.fillText(name,best.x+12,best.y+14);
      ctx.font="800 10px system-ui";ctx.fillStyle=Number(p.health)>40?"#5ee7b2":"#ff7b88";ctx.fillText(hp,best.x+box.w-hpWidth-7,best.y+14);
    });
  }

  function drawPlayers(ctx, frame, width, height) {
    frame.players.forEach(p => {
      const q=transform(p.X,p.Y,width,height), alive=p.is_alive && p.health>0;
      const c=alive?(colors[p.team_num]||"#bdbdbd"):"#8a8a8a";
      const rad=(Number(p.yaw)||0)*Math.PI/180;
      if(alive){
        ctx.strokeStyle="rgba(0,0,0,.9)";ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(q[0],q[1]);ctx.lineTo(q[0]+15*Math.cos(rad),q[1]-15*Math.sin(rad));ctx.stroke();
        ctx.strokeStyle=c;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(q[0],q[1]);ctx.lineTo(q[0]+15*Math.cos(rad),q[1]-15*Math.sin(rad));ctx.stroke();
      }
      ctx.fillStyle=alive?c:"#262626";ctx.strokeStyle=alive?"#fff":"#8a8a8a";ctx.lineWidth=2;ctx.beginPath();ctx.arc(q[0],q[1],alive?6:4,0,Math.PI*2);ctx.fill();ctx.stroke();
      if(!alive){ctx.strokeStyle="#d0d0d0";ctx.lineWidth=1.25;ctx.beginPath();ctx.moveTo(q[0]-2,q[1]-2);ctx.lineTo(q[0]+2,q[1]+2);ctx.moveTo(q[0]+2,q[1]-2);ctx.lineTo(q[0]-2,q[1]+2);ctx.stroke();}
    });
    drawPlayerLabels(ctx,frame.players,width,height);
  }

  function feedEvents(frame) {
    const recent=state.events.filter(e=>e.tick<=frame.tick && e.tick>=frame.tick-384).reverse();
    const selected=[], seen=new Map();
    const hasImpact=recent.some(event=>{const tag=actionMeta(event).tag;return tag==="HIT"||tag==="KILL"||tag==="HS";});
    for(const event of recent){
      const meta=actionMeta(event), key=`${event.event_name}:${event.actor||""}:${event.weapon||""}`;
      if(meta.tag==="SWING"&&hasImpact)continue;
      if((event.event_name==="weapon_fire"||event.event_name==="player_hurt") && seen.has(key) && seen.get(key)-event.tick<32) continue;
      seen.set(key,event.tick);selected.push({event,meta});if(selected.length>=7)break;
    }
    return selected;
  }

  function renderFeed(frame) {
    const rows=feedEvents(frame);
    $("event-feed").innerHTML=rows.map(({event,meta})=>{
      const age=Math.max(0,(frame.tick-event.tick)/64).toFixed(1);
      return `<div class="event-row ${esc(meta.kind)}"><span class="action-chip">${esc(meta.tag)}</span><div class="event-copy"><strong>${esc(meta.actor)}</strong><span>${esc(meta.verb)}</span><small>${age}s ago</small></div></div>`;
    }).join("")||'<div class="empty-feed">No recent actions</div>';
  }

  function money(value) {
    return `$${Math.max(0,Math.round(Number(value)||0)).toLocaleString()}`;
  }

  function displayWeapon(value) {
    const weapon=cleanWeapon(value);
    return weapon.replace(/\b\w/g,letter=>letter.toUpperCase());
  }

  function renderScoreboard(frame) {
    const board=$("live-scoreboard");if(!board||board.dataset.tick===String(frame.tick))return;
    board.dataset.tick=String(frame.tick);
    const teams=[{num:3,label:"Counter-Terrorists",short:"CT"},{num:2,label:"Terrorists",short:"T"}];
    board.innerHTML=teams.map(team=>{
      const players=frame.players.filter(player=>Number(player.team_num)===team.num).sort((a,b)=>(Number(b.is_alive)-Number(a.is_alive))||(Number(b.equip_value)-Number(a.equip_value)));
      const alive=players.filter(player=>player.is_alive&&Number(player.health)>0).length;
      const totalCash=players.reduce((sum,player)=>sum+(Number(player.balance)||0),0);
      const totalEquip=players.reduce((sum,player)=>sum+(Number(player.equip_value)||0),0);
      const rows=players.map(player=>{
        const isAlive=player.is_alive&&Number(player.health)>0;
        return `<div class="scoreboard-row ${isAlive?"":"eliminated"}">
          <div class="score-player"><span class="score-team-code ${team.short.toLowerCase()}">${team.short}</span><strong title="${esc(player.name)}">${esc(shortName(player.name))}</strong></div>
          <div><strong>${isAlive?Math.max(0,Math.round(Number(player.health)||0)):"OUT"}</strong><small>${Math.max(0,Math.round(Number(player.armor)||0))} armour</small></div>
          <div><strong>${money(player.balance)}</strong><small>cash</small></div>
          <div><strong title="${esc(displayWeapon(player.weapon))}">${esc(displayWeapon(player.weapon))}</strong><small>active weapon</small></div>
          <div><strong>${money(player.equip_value)}</strong><small>kit value</small></div>
        </div>`;
      }).join("");
      return `<section class="team-scoreboard ${team.short.toLowerCase()}">
        <div class="team-scoreboard-title"><strong>${team.label}</strong><span>${alive}/${players.length} alive · ${money(totalCash)} cash · ${money(totalEquip)} equipment</span></div>
        <div class="scoreboard-row scoreboard-columns"><span>Player</span><span>Health</span><span>Money</span><span>Equipment</span><span>Value</span></div>
        ${rows}
      </section>`;
    }).join("");
    $("scoreboard-clock").textContent=`${frame.time.toFixed(1)}s · tick ${frame.tick}`;
  }

  function draw() {
    const canvas=$("replay-canvas");if(!canvas)return;
    const dpr=window.devicePixelRatio||1,rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
    if(canvas.width!==Math.round(rect.width*dpr)||canvas.height!==Math.round(rect.height*dpr)){canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);}
    const ctx=canvas.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);
    const w=rect.width,h=rect.height;if(!state.frames.length){drawEmpty(ctx,w,h);return;}
    const frame=state.frames[state.index];drawBackground(ctx,w,h,frame);
    state.trails.forEach((trail,name)=>{
      const p=frame.players.find(x=>x.name===name);if(!p||trail.length<2)return;
      ctx.strokeStyle=colors[p.team_num]||"#bdcad9";ctx.globalAlpha=.42;ctx.lineWidth=2.5;ctx.beginPath();
      trail.forEach((xyz,i)=>{const q=transform(xyz[0],xyz[1],w,h);i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]);});ctx.stroke();ctx.globalAlpha=1;
    });
    drawActions(ctx,frame,w,h);drawPlayers(ctx,frame,w,h);renderScoreboard(frame);
    $("replay-seek").value=state.index;$("replay-time").textContent=`${frame.time.toFixed(1)}s  •  tick ${frame.tick}`;
    const lower=useLowerLevel(frame);$("replay-map-badge").textContent=`${state.map?.name||"Map"}${state.lowerImage?` • ${lower?"Lower":"Upper"}`:""}`;
    renderFeed(frame);
  }

  function loadImage(url,key){state[key]=null;if(!url)return;const img=new Image();img.onload=draw;img.onerror=()=>{state[key]=null;draw();};img.src=url;state[key]=img;}

  function loop(ts){
    setup();
    if(state.playing&&state.frames.length&&(!state.last||ts-state.last>=1000/(state.fps*state.speed))){state.last=ts;if(state.index>=state.frames.length-1){state.playing=false;$("replay-play").textContent="Play";}else{state.index++;updateTrails(state.frames[state.index]);draw();}}
    requestAnimationFrame(loop);
  }

  Shiny.addCustomMessageHandler("loadReplay",data=>{
    setup();state.frames=data.frames||[];state.events=data.events||[];state.bounds=data.bounds;state.map=data.map||null;state.fps=data.fps||8;state.round=data.round;state.index=0;state.playing=false;state.trails.clear();state.level="auto";state.zoom=1;state.panX=0;state.panY=0;updateZoomUI();
    $("replay-seek").max=Math.max(0,state.frames.length-1);$("replay-seek").value=0;$("replay-play").textContent="Play";$("replay-level").value="auto";
    loadImage(state.map?.image,"mapImage");loadImage(state.map?.lower_image,"lowerImage");$("replay-level").style.display=state.map?.lower_image?"inline-block":"none";
    $("replay-map-badge").textContent=state.map?.image?state.map.name:`${state.map?.name||"Map"} • coordinate view`;const board=$("live-scoreboard");if(board)board.dataset.tick="";updateTrails(state.frames[0]);draw();
  });

  Shiny.addCustomMessageHandler("parsingState",data=>{
    const button=$("parse");if(!button)return;button.disabled=Boolean(data.active);button.textContent=data.active?"Parsing demo…":"Parse demo";
  });
  window.addEventListener("resize",draw);
})();
