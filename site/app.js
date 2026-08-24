const competition=document.documentElement.dataset.competition??"msl";
const isA1=competition==="a1";
const SCHEDULE_URL=isA1?null:"https://hosted.dcd.shared.geniussports.com/embednf/MFL/en/competition/2393/schedule?phaseName=&poolNumber=0&matchType=REGULAR&roundNumber=-1&_cc=1&_nv=1&_mf=1";
const DATA_URL=isA1?"../data/a1.json":"./data/league.json";
const REFRESH_MS=isA1?300000:30000;
let state=null;
let nextRefresh=Date.now()+REFRESH_MS;

const $=selector=>document.querySelector(selector);
const escapeHtml=value=>String(value??"").replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
const score=value=>Number.isFinite(value)?value:"–";

function statusFromClass(className){
  if(className.includes("COMPLETE")) return "complete";
  if(className.includes("POSTPONED")) return "postponed";
  if(className.includes("IN_PROGRESS")||className.includes("LIVE")||className.includes("PERIODBREAK")) return "live";
  return "scheduled";
}

function parseOfficialSchedule(payload){
  const doc=new DOMParser().parseFromString(payload.html??"","text/html");
  return [...doc.querySelectorAll('.match-wrap[id^="extfix_"]')].map(block=>{
    const number=selector=>{const text=block.querySelector(selector)?.textContent?.trim()??"";return /^\d+$/.test(text)?Number(text):null};
    return {
      id:block.id.replace("extfix_",""),
      status:statusFromClass(block.className),
      homeScore:number(".homescore .fake-cell"),
      awayScore:number(".awayscore .fake-cell")
    };
  });
}

function mergeSchedule(matches,updates){
  const byId=new Map(updates.map(match=>[match.id,match]));
  return matches.map(match=>{
    const update=byId.get(match.id);
    if(!update) return match;
    return {...match,status:update.status,homeScore:update.homeScore??match.homeScore,awayScore:update.awayScore??match.awayScore};
  });
}

function calculateStandings(matches){
  const table=new Map();
  for(const match of matches){
    for(const [team,logo] of [[match.home,match.homeLogo],[match.away,match.awayLogo]]){
      if(!table.has(team)) table.set(team,{team,logo,played:0,won:0,drawn:0,lost:0,goalsFor:0,goalsAgainst:0,points:0,form:[]});
    }
    if(match.status!=="complete"||!Number.isFinite(match.homeScore)||!Number.isFinite(match.awayScore)) continue;
    const home=table.get(match.home),away=table.get(match.away);
    home.played++;away.played++;home.goalsFor+=match.homeScore;home.goalsAgainst+=match.awayScore;away.goalsFor+=match.awayScore;away.goalsAgainst+=match.homeScore;
    if(match.homeScore>match.awayScore){home.won++;home.points+=3;away.lost++;home.form.push("W");away.form.push("L")}
    else if(match.homeScore<match.awayScore){away.won++;away.points+=3;home.lost++;away.form.push("W");home.form.push("L")}
    else{home.drawn++;away.drawn++;home.points++;away.points++;home.form.push("D");away.form.push("D")}
  }
  return [...table.values()].map(row=>({...row,goalDifference:row.goalsFor-row.goalsAgainst,form:row.form.slice(-5)})).sort((a,b)=>b.points-a.points||b.goalDifference-a.goalDifference||b.goalsFor-a.goalsFor||a.team.localeCompare(b.team)).map((row,index)=>({...row,position:index+1}));
}

function clubMark(team,logo){
  if(logo) return `<img class="club-mark" src="${escapeHtml(logo)}" alt="">`;
  const initials=team.split(" ").filter(Boolean).slice(0,2).map(word=>word[0]).join("");
  return `<span class="club-mark club-fallback">${escapeHtml(initials)}</span>`;
}

function kickoff(value){
  const date=new Date(value);
  if(Number.isNaN(date.getTime())) return {date:value,time:""};
  return {
    date:new Intl.DateTimeFormat("en-MY",{weekday:"short",day:"numeric",month:"short",timeZone:"Asia/Kuala_Lumpur"}).format(date),
    time:new Intl.DateTimeFormat("en-MY",{hour:"numeric",minute:"2-digit",hour12:true,timeZone:"Asia/Kuala_Lumpur"}).format(date)
  };
}

function periodLabel(period){
  return period===1?"1st half":period===2?"2nd half":period===3?"Extra time · 1st":period===4?"Extra time · 2nd":"In play";
}

function clockSeconds(clock){
  const [minutes="0",seconds="0"]=String(clock??"").split(":");
  const total=Number.parseInt(minutes,10)*60+Number.parseInt(seconds,10);
  return Number.isFinite(total)?Math.max(0,total):null;
}

function currentClock(match){
  if(match.liveLabel==="Half-time"||match.liveStatus==="PERIODBREAK") return {time:"HT",period:"Half-time"};
  const base=clockSeconds(match.liveClock);
  if(base===null) return {time:match.liveLabel??"LIVE",period:periodLabel(match.livePeriod)};
  const since=Math.max(0,Math.floor((Date.now()-new Date(state.updatedAt).getTime())/1000));
  const total=base+(match.liveClockRunning?since:0);
  return {time:`${Math.floor(total/60)}:${String(total%60).padStart(2,"0")}`,period:periodLabel(match.livePeriod)};
}

function liveCard(match){
  const clock=currentClock(match);
  return `<article class="live-card"><div class="live-head"><span class="live-badge"><i></i>Live</span><span class="match-clock" data-clock-id="${escapeHtml(match.id)}"><strong>${escapeHtml(clock.time)}</strong><small>${escapeHtml(clock.period)}</small></span></div><div class="live-scoreline"><div>${clubMark(match.home,match.homeLogo)}<b>${escapeHtml(match.home)}</b></div><span><strong>${score(match.homeScore)}</strong><i>:</i><strong>${score(match.awayScore)}</strong></span><div>${clubMark(match.away,match.awayLogo)}<b>${escapeHtml(match.away)}</b></div></div><p>${escapeHtml(match.venue)}</p></article>`;
}

function matchCard(match){
  const when=kickoff(match.kickoff);
  const label=match.status==="complete"?"Full time":match.status==="postponed"?"Postponed":match.status==="live"?(match.liveLabel??"Live"):when.time;
  return `<article class="match-card"><div class="match-meta"><span>${escapeHtml(when.date)}</span><span class="status status-${escapeHtml(match.status)}">${escapeHtml(label)}</span></div><div class="match-team"><span>${clubMark(match.home,match.homeLogo)}${escapeHtml(match.home)}</span><strong>${score(match.homeScore)}</strong></div><div class="match-team"><span>${clubMark(match.away,match.awayLogo)}${escapeHtml(match.away)}</span><strong>${score(match.awayScore)}</strong></div><p class="venue">${escapeHtml(match.venue)}</p></article>`;
}

function renderClocks(){
  if(!state) return;
  for(const match of state.matches.filter(item=>item.status==="live")){
    const element=document.querySelector(`[data-clock-id="${CSS.escape(match.id)}"]`);
    if(!element) continue;
    const clock=currentClock(match);
    element.innerHTML=`<strong>${escapeHtml(clock.time)}</strong><small>${escapeHtml(clock.period)}</small>`;
  }
}

function render(){
  if(!state) return;
  const matches=state.matches;
  const completed=matches.filter(match=>match.status==="complete").sort((a,b)=>b.kickoff.localeCompare(a.kickoff));
  const live=matches.filter(match=>match.status==="live");
  const upcoming=matches.filter(match=>match.status==="scheduled").sort((a,b)=>a.kickoff.localeCompare(b.kickoff));
  const standings=calculateStandings(matches);
  const clubs=new Set(matches.flatMap(match=>[match.home,match.away])).size;
  const goals=completed.reduce((sum,match)=>sum+(match.homeScore??0)+(match.awayScore??0),0);
  $("#season").textContent=state.season;
  $("#live-board").hidden=!live.length;
  $("#live-grid").innerHTML=live.map(liveCard).join("");
  $("#metrics").innerHTML=isA1
    ?`<article><span class="metric-icon">◉</span><div><small>Clubs listed</small><strong>${clubs}</strong></div></article><article><span class="metric-icon">▦</span><div><small>Results shown</small><strong>${completed.length}</strong></div></article><article><span class="metric-icon">⚽</span><div><small>Goals in results</small><strong>${goals}</strong></div></article><article><span class="metric-icon">◷</span><div><small>${live.length?"Live now":"Next kickoff"}</small><strong>${live.length?`${live.length} match${live.length>1?"es":""}`:upcoming[0]?escapeHtml(kickoff(upcoming[0].kickoff).date):"TBC"}</strong></div></article>`
    :`<article><span class="metric-icon">⚽</span><div><small>League leader</small><strong>${escapeHtml(standings[0]?.team??"—")}</strong></div></article><article><span class="metric-icon">▦</span><div><small>Matches played</small><strong>${completed.length}</strong></div></article><article><span class="metric-icon">⚽</span><div><small>Goals scored</small><strong>${goals}</strong></div></article><article><span class="metric-icon">◷</span><div><small>${live.length?"Live now":"Next kickoff"}</small><strong>${live.length?`${live.length} match${live.length>1?"es":""}`:upcoming[0]?escapeHtml(kickoff(upcoming[0].kickoff).date):"TBC"}</strong></div></article>`;
  const hasOfficialStandings=Boolean(state.standingsImage);
  $("#official-standings").hidden=!hasOfficialStandings;
  $("#standings-table").hidden=hasOfficialStandings;
  $("#standings-legend").hidden=hasOfficialStandings;
  if(hasOfficialStandings){
    $("#official-standings-image").src=state.standingsImage;
    $("#official-standings-link").href=state.standingsSourceImage??state.sourceUrl??state.standingsImage;
  }else{
    $("#standings").innerHTML=standings.map(row=>`<tr><td><span class="rank rank-${row.position}">${row.position}</span></td><td class="team-cell">${clubMark(row.team,row.logo)}<span>${escapeHtml(row.team)}</span></td><td>${row.played}</td><td>${row.won}</td><td>${row.drawn}</td><td>${row.lost}</td><td>${row.goalDifference>0?"+":""}${row.goalDifference}</td><td><strong>${row.points}</strong></td><td class="form-cell">${row.form.map(result=>`<span class="form form-${result.toLowerCase()}">${result}</span>`).join("")||"—"}</td></tr>`).join("");
  }
  $("#results").innerHTML=completed.slice(0,4).map(matchCard).join("")||"<p class='notice'>No completed results yet.</p>";
  $("#fixtures").innerHTML=upcoming.slice(0,4).map(matchCard).join("")||"<p class='notice'>Fixtures will appear when announced.</p>";
  $("#updated").textContent=`Updated ${new Intl.DateTimeFormat("en-MY",{day:"numeric",month:"short",hour:"numeric",minute:"2-digit",hour12:true,timeZone:"Asia/Kuala_Lumpur"}).format(new Date(state.updatedAt))} MYT · ${state.refreshNote??"Scores check every 30 seconds."}`;
  $("#source-link").href=state.sourceUrl??$("#source-link").href;
  $("#source-link").textContent=`Source: ${state.source??"Official competition"} ↗`;
  $("#refresh-status").classList.toggle("is-live",live.length>0);
  renderClocks();
}

async function refresh(silent=false){
  if(!silent) $("#refresh-status").innerHTML="<i></i>Checking official data…";
  try{
    const requests=[fetch(`${DATA_URL}?v=${Date.now()}`,{cache:"no-store"}).then(response=>{if(!response.ok) throw new Error("Snapshot unavailable");return response.json()})];
    if(SCHEDULE_URL) requests.push(fetch(`${SCHEDULE_URL}&_=${Date.now()}`,{cache:"no-store"}).then(response=>{if(!response.ok) throw new Error("MFL unavailable");return response.json()}));
    const [snapshot,schedule]=await Promise.allSettled(requests);
    if(snapshot.status==="fulfilled"&&(!state||new Date(snapshot.value.updatedAt)>=new Date(state.updatedAt))) state=snapshot.value;
    if(!state) throw new Error("No verified data is available yet");
    if(schedule?.status==="fulfilled") state={...state,matches:mergeSchedule(state.matches,parseOfficialSchedule(schedule.value))};
    $("#notice").hidden=true;
    render();
  }catch(error){
    $("#notice").hidden=false;
    $("#notice").textContent=state?"The official feed is temporarily unavailable. Showing the last verified snapshot.":error.message;
  }
  nextRefresh=Date.now()+REFRESH_MS;
}

$("#refresh").addEventListener("click",()=>refresh());
setInterval(()=>{
  renderClocks();
  const remaining=Math.max(0,Math.ceil((nextRefresh-Date.now())/1000));
  if(remaining===0){refresh(true);return}
  if(state){
    const live=state.matches.some(match=>match.status==="live");
    const minutes=Math.floor(remaining/60),seconds=remaining%60;
    $("#refresh-status").innerHTML=`<i></i>${live?"Live update":"Auto-refresh"} in ${minutes}:${String(seconds).padStart(2,"0")}`;
  }
},1000);
refresh();
