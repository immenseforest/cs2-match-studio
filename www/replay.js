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

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width/2, height/2);
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.lineTo(x+width-r,y); ctx.quadraticCurveTo(x+width,y,x+width,y+r);
    ctx.lineTo(x+width,y+height-r); ctx.quadraticCurveTo(x+width,y+height,x+width-r,y+height);
    ctx.lineTo(x+r,y+height); ctx.quadraticCurveTo(x,y+height,x,y+height-r);
    ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
  }

  function drawEmpty(ctx, width, height) {
    ctx.fillStyle = "#07101b"; ctx.fillRect(0, 0, width, height);
    const box = mapBox(width, height);
    ctx.strokeStyle = "#35506d"; ctx.lineWidth = 1; ctx.setLineDash([7, 8]);
    ctx.strokeRect(box.x + 18, box.y + 18, box.size - 36, box.size - 36); ctx.setLineDash([]);
    ctx.textAlign = "center"; ctx.fillStyle = "#f7f9fc"; ctx.font = "700 18px system-ui";
    ctx.fillText("Tactical replay", width / 2, height / 2 - 8);
    ctx.fillStyle = "#bdcad9"; ctx.font = "14px system-ui";
    ctx.fillText("Upload and parse a demo to load the calibrated map", width / 2, height / 2 + 20);
    ctx.textAlign = "start";
  }

  function drawBackground(ctx, width, height, frame) {
    ctx.fillStyle = "#07101b"; ctx.fillRect(0, 0, width, height);
    const chosen = useLowerLevel(frame) ? state.lowerImage : state.mapImage;
    if (chosen && chosen.complete && chosen.naturalWidth) {
      const box = mapBox(width, height);
      ctx.drawImage(chosen, box.x, box.y, box.size, box.size);
      ctx.fillStyle = "rgba(4, 10, 18, .14)"; ctx.fillRect(box.x, box.y, box.size, box.size);
      ctx.strokeStyle = "#4d6c8d"; ctx.strokeRect(box.x, box.y, box.size, box.size);
      return;
    }
    ctx.strokeStyle = "#29445f"; ctx.lineWidth = 1;
    for (let i=1; i<9; i++) {
      ctx.beginPath(); ctx.moveTo(i*width/9,0); ctx.lineTo(i*width/9,height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0,i*height/9); ctx.lineTo(width,i*height/9); ctx.stroke();
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
      roundedRect(ctx,x,y,textWidth+12,17,5); ctx.fillStyle="rgba(4,9,16,.92)"; ctx.fill();
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
      ctx.strokeStyle="rgba(220,232,244,.55)";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(p.point[0],p.point[1]);ctx.lineTo(anchorX,anchorY);ctx.stroke();
      roundedRect(ctx,best.x,best.y,best.w,best.h,6);ctx.fillStyle="rgba(3,8,15,.91)";ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.stroke();
      ctx.fillStyle=color;ctx.fillRect(best.x+5,best.y+5,3,best.h-10);
      ctx.font="700 11px system-ui";ctx.fillStyle="#fff";ctx.fillText(name,best.x+12,best.y+14);
      ctx.font="800 10px system-ui";ctx.fillStyle=Number(p.health)>40?"#5ee7b2":"#ff7b88";ctx.fillText(hp,best.x+box.w-hpWidth-7,best.y+14);
    });
  }

  function drawPlayers(ctx, frame, width, height) {
    frame.players.forEach(p => {
      const q=transform(p.X,p.Y,width,height), alive=p.is_alive && p.health>0;
      const c=alive?(colors[p.team_num]||"#bdcad9"):"#8796a8";
      const rad=(Number(p.yaw)||0)*Math.PI/180;
      if(alive){
        ctx.strokeStyle="rgba(3,8,15,.9)";ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(q[0],q[1]);ctx.lineTo(q[0]+20*Math.cos(rad),q[1]-20*Math.sin(rad));ctx.stroke();
        ctx.strokeStyle=c;ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(q[0],q[1]);ctx.lineTo(q[0]+20*Math.cos(rad),q[1]-20*Math.sin(rad));ctx.stroke();
      }
      ctx.fillStyle=alive?c:"#26384b";ctx.strokeStyle=alive?"#fff":"#8796a8";ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(q[0],q[1],alive?9:6,0,Math.PI*2);ctx.fill();ctx.stroke();
      if(!alive){ctx.strokeStyle="#cbd5e1";ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(q[0]-3,q[1]-3);ctx.lineTo(q[0]+3,q[1]+3);ctx.moveTo(q[0]+3,q[1]-3);ctx.lineTo(q[0]-3,q[1]+3);ctx.stroke();}
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
    drawActions(ctx,frame,w,h);drawPlayers(ctx,frame,w,h);
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
    setup();state.frames=data.frames||[];state.events=data.events||[];state.bounds=data.bounds;state.map=data.map||null;state.fps=data.fps||8;state.round=data.round;state.index=0;state.playing=false;state.trails.clear();state.level="auto";
    $("replay-seek").max=Math.max(0,state.frames.length-1);$("replay-seek").value=0;$("replay-play").textContent="Play";$("replay-level").value="auto";
    loadImage(state.map?.image,"mapImage");loadImage(state.map?.lower_image,"lowerImage");$("replay-level").style.display=state.map?.lower_image?"inline-block":"none";
    $("replay-map-badge").textContent=state.map?.image?state.map.name:`${state.map?.name||"Map"} • coordinate view`;updateTrails(state.frames[0]);draw();
  });

  Shiny.addCustomMessageHandler("parsingState",data=>{
    const button=$("parse");if(!button)return;button.disabled=Boolean(data.active);button.textContent=data.active?"Parsing demo…":"Parse demo";
  });
  window.addEventListener("resize",draw);
})();
