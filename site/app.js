const competition=document.documentElement.dataset.competition??"msl";
const competitionConfig={
  msl:{dataUrl:"./data/league.json",mflCompetitionId:2393},
  a1:{dataUrl:"../data/a1.json"},
  facup:{dataUrl:"../data/fa-cup.json",mflCompetitionId:2394}
}[competition]??{dataUrl:"./data/league.json",mflCompetitionId:2393};
const isA1=competition==="a1";
const isFaCup=competition==="facup";
const SCHEDULE_URL=competitionConfig.mflCompetitionId?`https://hosted.dcd.shared.geniussports.com/embednf/MFL/en/competition/${competitionConfig.mflCompetitionId}/schedule?phaseName=&poolNumber=0&matchType=REGULAR&roundNumber=-1&_cc=1&_nv=1&_mf=1`:null;
const DATA_URL=competitionConfig.dataUrl;
const SOFA_BASES=["https://www.sofascore.com/api/v1","https://api.sofascore.com/api/v1"];
const SOFA_TOURNAMENT=22740;
const SOFA_SEASON=100870;
const REFRESH_MS=30000;
const A1_TEAMS=["AAK UNISEL FC","ARMED FORCES FC","BUNGA RAYA FC","IMIGRESEN FC II","JDT II","KEDAH FA","KELANTAN CITY FC","MANJUNG CITY FC","MALAYSIAN UNIVERSITY – UiTM","NEGERI SEMBILAN FC II","PERAK FA","SELANGOR FC II","UM – DAMANSARA UNITED","USM FC"];
const A1_TEAM_NAMES=new Map(A1_TEAMS.map(team=>[team.toUpperCase(),team]));
let state=null;
let nextRefresh=Date.now()+REFRESH_MS;

const $=selector=>document.querySelector(selector);
const escapeHtml=value=>String(value??"").replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
const score=value=>Number.isFinite(value)?value:"–";

function canonicalTeam(value){
  const name=String(value??"").trim().replace(/\s*-\s*/g," – ");
  const aliases={
    "AAK PUNCAK ALAM FC":"AAK UNISEL FC","ATM":"ARMED FORCES FC","ATM FA":"ARMED FORCES FC","JDT U23":"JDT II","JOHOR DARUL TAZIM II":"JDT II","JOHOR DARUL TA'ZIM II":"JDT II","JOHOR DARUL TA'ZIM U23":"JDT II","KFA":"KEDAH FA","KELANTAN WTS":"KELANTAN CITY FC","KELANTAN WTS FC":"KELANTAN CITY FC","WAN TENDONG STABLE":"KELANTAN CITY FC","WTS":"KELANTAN CITY FC","MALAYSIA UNIVERSITY":"MALAYSIAN UNIVERSITY – UiTM","MALAYSIAN UNIVERSITY – UITM":"MALAYSIAN UNIVERSITY – UiTM","NEGERI SEMBILAN II":"NEGERI SEMBILAN FC II","PERAK":"PERAK FA","SELANGOR U23":"SELANGOR FC II","STAR CITY FC II":"IMIGRESEN FC II"
  };
  const key=name.toUpperCase();
  return aliases[key]??A1_TEAM_NAMES.get(key)??name;
}

function sofaScore(score){
  for(const key of ["current","normaltime","display","period2","period1"]) if(Number.isFinite(score?.[key])) return Number(score[key]);
  return null;
}

function sofaMatchStatus(event){
  const type=String(event?.status?.type??"").toLowerCase();
  if(["finished","afterpenalties","afterextra"].includes(type)) return "complete";
  if(["inprogress","live"].includes(type)) return "live";
  if(["postponed","canceled","cancelled"].includes(type)) return "postponed";
  return "scheduled";
}

function sofaLiveClock(event){
  const description=String(event?.status?.description??event?.status?.period??"");
  const halfTime=/half.?time|period break/i.test(description);
  const initial=Number(event?.time?.initial??0),start=Number(event?.time?.currentPeriodStartTimestamp);
  const elapsed=Number.isFinite(start)?Math.max(0,Math.floor(Date.now()/1000-start)):0;
  const total=Math.max(0,initial+(halfTime?0:elapsed));
  return {liveLabel:halfTime?"Half-time":"Live",liveStatus:halfTime?"PERIODBREAK":"IN_PROGRESS",livePeriod:/2nd|second/i.test(description)||initial>=2700?2:1,liveClock:`${Math.floor(total/60)}:${String(total%60).padStart(2,"0")}`,liveClockRunning:!halfTime,clockUpdatedAt:new Date().toISOString()};
}

function parseSofaEvents(payload){
  return (Array.isArray(payload?.events)?payload.events:[]).map(event=>{
    const status=sofaMatchStatus(event),timestamp=Number(event?.startTimestamp)*1000;
    return {id:`sofa-${event.id}`,sofaId:event.id,status,kickoff:Number.isFinite(timestamp)?new Date(timestamp).toISOString():"",venue:event?.venue?.stadium?.name??event?.venue?.name??"",home:canonicalTeam(event?.homeTeam?.name),away:canonicalTeam(event?.awayTeam?.name),homeScore:sofaScore(event?.homeScore),awayScore:sofaScore(event?.awayScore),homeLogo:event?.homeTeam?.id?`https://api.sofascore.app/api/v1/team/${event.homeTeam.id}/image`:"",awayLogo:event?.awayTeam?.id?`https://api.sofascore.app/api/v1/team/${event.awayTeam.id}/image`:"",...(status==="live"?sofaLiveClock(event):{})};
  }).filter(match=>match.home&&match.away&&match.kickoff);
}

function a1MatchKey(match){return `${canonicalTeam(match.home).toUpperCase()}|${canonicalTeam(match.away).toUpperCase()}|${match.kickoff.slice(0,10)}`}

function mergeA1Matches(matches,updates){
  const merged=new Map(matches.map(match=>[a1MatchKey(match),match]));
  for(const update of updates){
    const key=a1MatchKey(update),existing=merged.get(key);
    merged.set(key,{...existing,...update,id:existing?.id??update.id,venue:existing?.venue||update.venue,homeLogo:existing?.homeLogo||update.homeLogo,awayLogo:existing?.awayLogo||update.awayLogo});
  }
  const normalized=[...merged.values()].map(match=>({...match,home:canonicalTeam(match.home),away:canonicalTeam(match.away)}));
  const completed=normalized.filter(match=>match.status==="complete");
  return normalized.filter(match=>match.status!=="scheduled"||!completed.some(result=>result.home===match.home&&result.away===match.away&&Math.abs(Date.parse(result.kickoff)-Date.parse(match.kickoff))<=36*60*60*1000)).sort((a,b)=>a.kickoff.localeCompare(b.kickoff));
}

function parseSofaStandings(payload,matches){
  const rows=(Array.isArray(payload?.standings)?payload.standings:[]).flatMap(group=>Array.isArray(group?.rows)?group.rows:[]);
  const logos=new Map(matches.flatMap(match=>[[match.home,match.homeLogo],[match.away,match.awayLogo]]));
  return rows.map(row=>{const team=canonicalTeam(row?.team?.name),goalsFor=Number(row?.scoresFor??0),goalsAgainst=Number(row?.scoresAgainst??0);return {team,logo:logos.get(team)||(row?.team?.id?`https://api.sofascore.app/api/v1/team/${row.team.id}/image`:""),played:Number(row?.matches??0),won:Number(row?.wins??0),drawn:Number(row?.draws??0),lost:Number(row?.losses??0),goalsFor,goalsAgainst,points:Number(row?.points??0),goalDifference:Number(row?.scoreDiff??goalsFor-goalsAgainst),position:Number(row?.position??999),form:[]}}).filter(row=>row.team&&row.position<999).sort((a,b)=>a.position-b.position);
}

async function fetchSofa(path){
  let lastError;
  for(const base of SOFA_BASES){
    try{const response=await fetch(`${base}${path}?_=${Date.now()}`,{cache:"no-store"});if(!response.ok) throw new Error(`HTTP ${response.status}`);return await response.json()}catch(error){lastError=error}
  }
  throw lastError??new Error("Sofascore unavailable");
}

async function fetchA1Live(){
  const root=`/unique-tournament/${SOFA_TOURNAMENT}/season/${SOFA_SEASON}`;
  const [previous,upcoming,standings]=await Promise.all([fetchSofa(`${root}/events/last/0`),fetchSofa(`${root}/events/next/0`),fetchSofa(`${root}/standings/total`)]);
  return {matches:parseSofaEvents({events:[...(previous.events??[]),...(upcoming.events??[])]}),standings};
}

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

function newsDate(value){
  const date=new Date(value);
  if(Number.isNaN(date.getTime())) return "Latest update";
  return new Intl.DateTimeFormat("en-MY",{day:"numeric",month:"short",year:"numeric",timeZone:"Asia/Kuala_Lumpur"}).format(date);
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
  const since=Math.max(0,Math.floor((Date.now()-new Date(match.clockUpdatedAt??state.updatedAt).getTime())/1000));
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

const CUP_STAGES=[
  {name:"Round of 16",matches:16,detail:"8 ties · two legs"},
  {name:"Quarter-finals",matches:8,detail:"4 ties · two legs"},
  {name:"Semi-finals",matches:4,detail:"2 ties · two legs"},
  {name:"Final",matches:1,detail:"One-match final"}
];

function currentCupStage(matches){
  const completed=matches.filter(match=>match.status==="complete").length;
  let finish=0;
  const current=CUP_STAGES.findIndex(stage=>{finish+=stage.matches;return completed<finish});
  return current<0?CUP_STAGES.length-1:current;
}

function renderCupProgress(matches){
  const current=currentCupStage(matches);
  const completedMatches=matches.filter(match=>match.status==="complete").length;
  const live=matches.some(match=>match.status==="live");
  let start=0;
  return CUP_STAGES.map((stage,index)=>{
    const completed=Math.min(stage.matches,Math.max(0,completedMatches-start));
    const known=Math.min(stage.matches,Math.max(0,matches.length-start));
    const complete=completed===stage.matches;
    const stateClass=complete?"is-complete":index===current?"is-current":"is-upcoming";
    const status=complete?"Complete":live&&index===current?"Live now":index===current?"In progress":"Upcoming";
    const detail=known?`${completed} of ${stage.matches} matches complete`:stage.detail;
    const card=`<article class="cup-stage ${stateClass}"><div class="cup-stage-top"><span>0${index+1}</span><b>${escapeHtml(status)}</b></div><h3>${escapeHtml(stage.name)}</h3><div class="cup-stage-track"><i style="width:${Math.min(100,completed/stage.matches*100)}%"></i></div><p>${escapeHtml(detail)}</p></article>`;
    start+=stage.matches;
    return card;
  }).join("");
}

function newsCard(item){
  return `<article class="news-card"><p class="news-meta"><span>${escapeHtml(newsDate(item.date))}</span><span>${escapeHtml(item.source??state.source??"Official")}</span></p><h3>${escapeHtml(item.title)}</h3><p class="news-snippet">${escapeHtml(item.excerpt)}</p><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Read at source <span aria-hidden="true">↗</span></a></article>`;
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
  const upcoming=matches.filter(match=>match.status==="scheduled"&&new Date(match.kickoff).getTime()>Date.now()-10800000).sort((a,b)=>a.kickoff.localeCompare(b.kickoff));
  const goals=completed.reduce((sum,match)=>sum+(match.homeScore??0)+(match.awayScore??0),0);
  $("#season").textContent=state.season;
  $("#live-board").hidden=!live.length;
  $("#live-grid").innerHTML=live.map(liveCard).join("");
  if(isFaCup){
    const stage=CUP_STAGES[currentCupStage(matches)]?.name??"Round of 16";
    const clubs=new Set(matches.flatMap(match=>[match.home,match.away]).filter(team=>team&&team!=="TBC")).size;
    $("#metrics").innerHTML=`<article><span class="metric-icon">🏆</span><div><small>Current stage</small><strong>${escapeHtml(stage)}</strong></div></article><article><span class="metric-icon">◆</span><div><small>Clubs</small><strong>${clubs}</strong></div></article><article><span class="metric-icon">✓</span><div><small>Matches played</small><strong>${completed.length}</strong></div></article><article><span class="metric-icon">◷</span><div><small>${live.length?"Live now":"Next kickoff"}</small><strong>${live.length?`${live.length} match${live.length>1?"es":""}`:upcoming[0]?escapeHtml(kickoff(upcoming[0].kickoff).date):"TBC"}</strong></div></article>`;
    $("#cup-rounds").innerHTML=renderCupProgress(matches);
  }else{
    const standings=Array.isArray(state.standings)&&state.standings.length?state.standings:calculateStandings(matches);
    const leaderLabel=completed.length?"League leader":"Season status";
    const leaderValue=completed.length?(standings[0]?.team??"—"):(upcoming.length?"Opening round":"Pre-season");
    $("#metrics").innerHTML=`<article><span class="metric-icon">⚽</span><div><small>${leaderLabel}</small><strong>${escapeHtml(leaderValue)}</strong></div></article><article><span class="metric-icon">▦</span><div><small>Matches played</small><strong>${completed.length}</strong></div></article><article><span class="metric-icon">⚽</span><div><small>Goals scored</small><strong>${goals}</strong></div></article><article><span class="metric-icon">◷</span><div><small>${live.length?"Live now":"Next kickoff"}</small><strong>${live.length?`${live.length} match${live.length>1?"es":""}`:upcoming[0]?escapeHtml(kickoff(upcoming[0].kickoff).date):"TBC"}</strong></div></article>`;
    $("#standings").innerHTML=standings.map(row=>`<tr><td><span class="rank rank-${row.position}">${row.position}</span></td><td class="team-cell">${clubMark(row.team,row.logo)}<span>${escapeHtml(row.team)}</span></td><td>${row.played}</td><td>${row.won}</td><td>${row.drawn}</td><td>${row.lost}</td><td>${row.goalDifference>0?"+":""}${row.goalDifference}</td><td><strong>${row.points}</strong></td><td class="form-cell">${row.form.map(result=>`<span class="form form-${result.toLowerCase()}">${result}</span>`).join("")||"—"}</td></tr>`).join("");
  }
  $("#results").innerHTML=completed.slice(0,4).map(matchCard).join("")||"<p class='notice'>No completed results yet.</p>";
  $("#fixtures").innerHTML=upcoming.slice(0,4).map(matchCard).join("")||"<p class='notice'>Fixtures will appear when announced.</p>";
  const news=Array.isArray(state.news)?state.news:[];
  $("#news").innerHTML=news.slice(0,3).map(newsCard).join("")||"<p class='news-empty'>No official competition updates are available right now.</p>";
  $("#updated").textContent=`Updated ${new Intl.DateTimeFormat("en-MY",{day:"numeric",month:"short",hour:"numeric",minute:"2-digit",hour12:true,timeZone:"Asia/Kuala_Lumpur"}).format(new Date(state.updatedAt))} MYT · ${state.refreshNote??"Scores check every 30 seconds."}`;
  $("#source-link").href=state.sourceUrl??$("#source-link").href;
  $("#source-link").textContent=isA1?"Fixtures, venues & news: AFL ↗":`Source: ${state.source??"Official competition"} ↗`;
  $("#refresh-status").classList.toggle("is-live",live.length>0);
  renderClocks();
}

async function refresh(silent=false){
  if(!silent) $("#refresh-status").innerHTML="<i></i>Checking official data…";
  nextRefresh=Date.now()+REFRESH_MS;
  let snapshotError=null;
  try{
    const response=await fetch(`${DATA_URL}?v=${Date.now()}`,{cache:"no-store"});
    if(!response.ok) throw new Error("Snapshot unavailable");
    const snapshot=await response.json();
    if(!state||new Date(snapshot.updatedAt)>=new Date(state.updatedAt)) state=snapshot;
    $("#notice").hidden=true;
    render();
  }catch(error){
    snapshotError=error;
    if(!state){
      $("#notice").hidden=false;
      $("#notice").textContent=error.message;
      return;
    }
    $("#notice").hidden=false;
    $("#notice").textContent="The latest snapshot is temporarily unavailable. Showing the last verified data.";
    render();
  }

  try{
    if(SCHEDULE_URL){
      const response=await fetch(`${SCHEDULE_URL}&_=${Date.now()}`,{cache:"no-store"});
      if(!response.ok) throw new Error("MFL unavailable");
      state={...state,matches:mergeSchedule(state.matches,parseOfficialSchedule(await response.json()))};
    }else if(isA1){
      const liveUpdate=await fetchA1Live();
      const matches=mergeA1Matches(state.matches,liveUpdate.matches);
      const standings=parseSofaStandings(liveUpdate.standings,matches);
      state={...state,matches,standings:standings.length?standings:state.standings,liveUpdatedAt:new Date().toISOString()};
    }
    if(!snapshotError) $("#notice").hidden=true;
    render();
  }catch{}
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
