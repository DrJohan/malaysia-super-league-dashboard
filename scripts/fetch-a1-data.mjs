import {mkdir,readFile,writeFile} from "node:fs/promises";

const sourceUrl="https://the-afl.my/";
const newsUrl="https://the-afl.my/wp-json/wp/v2/posts?per_page=6&_fields=date,link,title,excerpt";
const sofascorePageUrl="https://www.sofascore.com/football/tournament/malaysia/liga-a1/22740#id:100870";
const resultsFallbackUrl="https://footystats.org/malaysia/liga-a1";
const sofascoreBases=["https://www.sofascore.com/api/v1","https://api.sofascore.com/api/v1"];
const sofascoreBase=sofascoreBases[0];
const sofascoreTournament=22740;
const sofascoreSeason=100870;
const sofascoreUrls={
  previous:`${sofascoreBase}/unique-tournament/${sofascoreTournament}/season/${sofascoreSeason}/events/last/0`,
  upcoming:`${sofascoreBase}/unique-tournament/${sofascoreTournament}/season/${sofascoreSeason}/events/next/0`,
  standings:`${sofascoreBase}/unique-tournament/${sofascoreTournament}/season/${sofascoreSeason}/standings/total`
};
const deployedSnapshotUrl="https://drjohan.github.io/malaysia-super-league-dashboard/data/a1.json";
const seasonStart="2026-08-28";
const headers={Accept:"text/html,application/xhtml+xml", "User-Agent":"MYSL Match Centre GitHub Pages Dashboard/1.0"};
const tableOrder=["AAK UNISEL FC","ARMED FORCES FC","BUNGA RAYA FC","IMIGRESEN FC II","JDT II","KEDAH FA","KELANTAN CITY FC","MANJUNG CITY FC","MALAYSIAN UNIVERSITY – UiTM","NEGERI SEMBILAN FC II","PERAK FA","SELANGOR FC II","UM – DAMANSARA UNITED","USM FC"];
const officialTeamNames=new Map(tableOrder.map(team=>[team.toUpperCase(),team]));

function decode(value=""){
  return String(value??"")
    .replace(/&#x([0-9a-f]+);/gi,(_,code)=>String.fromCodePoint(Number.parseInt(code,16)))
    .replace(/&#(\d+);/g,(_,code)=>String.fromCodePoint(Number(code)))
    .replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&apos;|&#039;/g,"'").replace(/&ndash;|&mdash;/g,"–").replace(/&nbsp;/g," ");
}
function clean(value=""){return decode(String(value??"").replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim()}
function snippet(value,maxLength=190){
  const text=clean(value);
  if(text.length<=maxLength) return text;
  const shortened=text.slice(0,maxLength-1).replace(/\s+\S*$/,"").trim();
  return `${shortened||text.slice(0,maxLength-1).trim()}…`;
}
function capture(block,pattern){return clean(block.match(pattern)?.[1]??"")}
function imageFrom(block){return decode(block.match(/<img[^>]+src="([^"]+)"/i)?.[1]??"")}
function slug(value){return value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}
function canonicalTeam(value){
  const name=clean(value).replace(/\s*-\s*/g," – ");
  const aliases={
    "AAK PUNCAK ALAM FC":"AAK UNISEL FC",
    "AAK PUNCAK ALAM":"AAK UNISEL FC",
    "ATM":"ARMED FORCES FC",
    "ATM FA":"ARMED FORCES FC",
    "KFA":"KEDAH FA",
    "PERAK":"PERAK FA",
    "JDT U23":"JDT II",
    "JOHOR DARUL TAZIM II":"JDT II",
    "JOHOR DARUL TA'ZIM II":"JDT II",
    "JOHOR DARUL TA'ZIM U23":"JDT II",
    "KELANTAN WTS":"KELANTAN CITY FC",
    "KELANTAN WTS FC":"KELANTAN CITY FC",
    "WAN TENDONG STABLE":"KELANTAN CITY FC",
    "WTS":"KELANTAN CITY FC",
    "MALAYSIAN UNIVERSITY":"MALAYSIAN UNIVERSITY – UiTM",
    "MALAYSIAN UNIVERSITY – UITM":"MALAYSIAN UNIVERSITY – UiTM",
    "MALAYSIA UNIVERSITY":"MALAYSIAN UNIVERSITY – UiTM",
    "UNIVERSITY MALAYA":"MALAYSIAN UNIVERSITY – UiTM",
    "UNIVERSITY OF MALAYA FC":"MALAYSIAN UNIVERSITY – UiTM",
    "NEGERI SEMBILAN II":"NEGERI SEMBILAN FC II",
    "SELANGOR U23":"SELANGOR FC II",
    "SELANGOR FC UNDER 23":"SELANGOR FC II",
    "STAR CITY FC II":"IMIGRESEN FC II",
    "IMIGRESEN II":"IMIGRESEN FC II",
    "USM STAF":"USM FC",
    "UM DAMANSARA":"UM – DAMANSARA UNITED",
    "USM FC":"USM FC",
    "UM – DAMANSARA UNITED":"UM – DAMANSARA UNITED"
  };
  const key=name.toUpperCase();
  return aliases[key]??officialTeamNames.get(key)??name;
}

function scoreValue(score){
  for(const key of ["current","normaltime","display","period2","period1"]){
    if(Number.isFinite(score?.[key])) return Number(score[key]);
  }
  return null;
}

function sofaStatus(event){
  const type=String(event?.status?.type??"").toLowerCase();
  if(["finished","afterpenalties","afterextra"].includes(type)) return "complete";
  if(["inprogress","live"].includes(type)) return "live";
  if(["postponed","canceled","cancelled"].includes(type)) return "postponed";
  return "scheduled";
}

function sofaClock(event){
  const status=String(event?.status?.description??event?.status?.period??"");
  const halfTime=/half.?time|period break/i.test(status);
  const initial=Number(event?.time?.initial??0);
  const start=Number(event?.time?.currentPeriodStartTimestamp);
  const elapsed=Number.isFinite(start)?Math.max(0,Math.floor(Date.now()/1000-start)):0;
  const seconds=Math.max(0,initial+(halfTime?0:elapsed));
  const period=/2nd|second/i.test(status)||initial>=2700?2:1;
  return {liveLabel:halfTime?"Half-time":"Live",liveStatus:halfTime?"PERIODBREAK":"IN_PROGRESS",livePeriod:period,liveClock:`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`,liveClockRunning:!halfTime};
}

function parseSofaEvents(payload){
  return (Array.isArray(payload?.events)?payload.events:[]).map(event=>{
    const home=canonicalTeam(event?.homeTeam?.name??"TBC");
    const away=canonicalTeam(event?.awayTeam?.name??"TBC");
    const kickoffTime=Number(event?.startTimestamp)*1000;
    const status=sofaStatus(event);
    return {
      id:`sofa-${event.id}`,
      sofaId:event.id,
      status,
      kickoff:Number.isFinite(kickoffTime)?new Date(kickoffTime).toISOString():"",
      venue:clean(event?.venue?.stadium?.name??event?.venue?.name??""),
      home,away,
      homeScore:scoreValue(event?.homeScore),
      awayScore:scoreValue(event?.awayScore),
      homeLogo:event?.homeTeam?.id?`https://api.sofascore.app/api/v1/team/${event.homeTeam.id}/image`:"",
      awayLogo:event?.awayTeam?.id?`https://api.sofascore.app/api/v1/team/${event.awayTeam.id}/image`:"",
      ...(status==="live"?sofaClock(event):{})
    };
  }).filter(match=>match.home!=="TBC"&&match.away!=="TBC"&&match.kickoff.slice(0,10)>=seasonStart);
}

function matchKey(match){return `${canonicalTeam(match.home).toUpperCase()}|${canonicalTeam(match.away).toUpperCase()}|${match.kickoff.slice(0,10)}`}

function mergeSofaMatches(matches,sofaMatches){
  const merged=new Map(matches.map(match=>[matchKey(match),match]));
  for(const update of sofaMatches){
    const key=matchKey(update),existing=merged.get(key);
    merged.set(key,{...existing,...update,id:existing?.id??update.id,venue:existing?.venue||update.venue,homeLogo:existing?.homeLogo||update.homeLogo,awayLogo:existing?.awayLogo||update.awayLogo});
  }
  return [...merged.values()].sort((a,b)=>a.kickoff.localeCompare(b.kickoff));
}

function removeSupersededFixtures(matches){
  const normalized=matches.map(match=>({...match,home:canonicalTeam(match.home),away:canonicalTeam(match.away)}));
  const completed=normalized.filter(match=>match.status==="complete");
  return normalized.filter(match=>{
    if(match.status!=="scheduled") return true;
    const kickoff=Date.parse(match.kickoff);
    return !completed.some(result=>result.home===match.home&&result.away===match.away&&Math.abs(Date.parse(result.kickoff)-kickoff)<=36*60*60*1000);
  });
}

function reconcileCompletedFixtures(matches,standings){
  const totals=new Map(tableOrder.map(team=>[team,{played:0,goalsFor:0,goalsAgainst:0}]));
  const add=(team,goalsFor,goalsAgainst)=>{
    const row=totals.get(team)??{played:0,goalsFor:0,goalsAgainst:0};
    row.played++;row.goalsFor+=goalsFor;row.goalsAgainst+=goalsAgainst;totals.set(team,row);
  };
  for(const match of matches){
    if(match.status!=="complete"||!Number.isFinite(match.homeScore)||!Number.isFinite(match.awayScore)) continue;
    add(match.home,match.homeScore,match.awayScore);add(match.away,match.awayScore,match.homeScore);
  }
  const published=new Map(standings.map(row=>[row.team,row]));
  const now=Date.now();
  const safeBefore=Date.now()-125*60*1000;
  return matches.map(match=>{
    if(match.status!=="scheduled"||Date.parse(match.kickoff)>now) return match;
    const home=published.get(match.home),away=published.get(match.away);
    const homeTotals=totals.get(match.home)??{played:0,goalsFor:0,goalsAgainst:0};
    const awayTotals=totals.get(match.away)??{played:0,goalsFor:0,goalsAgainst:0};
    if(!home||!away||home.played-homeTotals.played!==1||away.played-awayTotals.played!==1) return match;
    const homeScore=home.goalsFor-homeTotals.goalsFor,awayScore=home.goalsAgainst-homeTotals.goalsAgainst;
    if(homeScore<0||awayScore<0||away.goalsFor-awayTotals.goalsFor!==awayScore||away.goalsAgainst-awayTotals.goalsAgainst!==homeScore) return match;
    if(Date.parse(match.kickoff)>safeBefore){
      return {...match,status:"live",homeScore,awayScore,liveLabel:"Score update",liveStatus:"IN_PROGRESS",liveClockRunning:false,reconciledFromStandings:true};
    }
    add(match.home,homeScore,awayScore);add(match.away,awayScore,homeScore);
    return {...match,status:"complete",homeScore,awayScore,reconciledFromStandings:true};
  });
}

function parseSofaStandings(payload,logoByTeam){
  const rows=(Array.isArray(payload?.standings)?payload.standings:[]).flatMap(group=>Array.isArray(group?.rows)?group.rows:[]);
  return rows.map(row=>{
    const team=canonicalTeam(row?.team?.name??"");
    const goalsFor=Number(row?.scoresFor??0),goalsAgainst=Number(row?.scoresAgainst??0);
    return {team,logo:logoByTeam.get(team)??(row?.team?.id?`https://api.sofascore.app/api/v1/team/${row.team.id}/image`:""),played:Number(row?.matches??0),won:Number(row?.wins??0),drawn:Number(row?.draws??0),lost:Number(row?.losses??0),goalsFor,goalsAgainst,points:Number(row?.points??0),form:[],goalDifference:Number(row?.scoreDiff??goalsFor-goalsAgainst),position:Number(row?.position??999)};
  }).filter(row=>row.team&&row.position<999).sort((a,b)=>a.position-b.position);
}

async function fetchSofaJson(url){
  let lastError;
  for(const base of sofascoreBases){
    try{
      const endpoint=url.replace(sofascoreBase,base);
      const response=await fetch(endpoint,{headers:{Accept:"application/json","User-Agent":"Mozilla/5.0 (compatible; MYSL Match Centre/1.0)",Referer:"https://www.sofascore.com/"},signal:AbortSignal.timeout(15000)});
      if(!response.ok) throw new Error(`Sofascore returned ${response.status}`);
      return response.json();
    }catch(error){lastError=error}
  }
  throw lastError??new Error("Sofascore unavailable");
}

async function fetchSofaData(){
  const [previous,upcoming,standings]=await Promise.all([fetchSofaJson(sofascoreUrls.previous),fetchSofaJson(sofascoreUrls.upcoming),fetchSofaJson(sofascoreUrls.standings)]);
  return {matches:parseSofaEvents({events:[...(previous.events??[]),...(upcoming.events??[])]}),standings};
}

function parseNextData(html){
  const encoded=html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  if(!encoded) throw new Error("Sofascore page did not contain standings data");
  const page=JSON.parse(encoded);
  const standings=page?.props?.pageProps?.standings;
  if(!Array.isArray(standings)||!standings.length) throw new Error("Sofascore standings were empty");
  return standings;
}

function parseFallbackResults(html){
  const starts=[...html.matchAll(/<tr class='match complete'[^>]*>/g)];
  return starts.map((entry,index)=>{
    const block=html.slice(entry.index,starts[index+1]?.index??html.length);
    const timestamp=Number(block.match(/<td data-time='(\d+)'/)?.[1]);
    const home=canonicalTeam(clean(block.match(/class=['"]team-home['"][\s\S]*?<span itemprop='name'>([\s\S]*?)<\/span>/i)?.[1]));
    const away=canonicalTeam(clean(block.match(/class=['"]team-away['"][\s\S]*?<span itemprop='name'>([\s\S]*?)<\/span>/i)?.[1]));
    const score=clean(block.match(/class='bold ft-score'>([\s\S]*?)<\/span>/i)?.[1]).match(/(\d+)\s*-\s*(\d+)/);
    const kickoffTime=timestamp*1000;
    return {id:`fallback-${slug(home)}-${slug(away)}-${new Date(kickoffTime).toISOString().slice(0,10)}`,status:"complete",kickoff:new Date(kickoffTime).toISOString(),venue:"",home,away,homeScore:score?Number(score[1]):null,awayScore:score?Number(score[2]):null,homeLogo:"",awayLogo:""};
  }).filter(match=>match.home&&match.away&&match.homeScore!==null&&match.kickoff.slice(0,10)>=seasonStart);
}

async function fetchPublishedFallback(){
  const pageHeaders={Accept:"text/html,application/xhtml+xml","User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36"};
  const [sofaPage,resultsPage]=await Promise.all([fetch(sofascorePageUrl,{headers:pageHeaders,signal:AbortSignal.timeout(20000)}),fetch(resultsFallbackUrl,{headers:pageHeaders,signal:AbortSignal.timeout(20000)})]);
  if(!sofaPage.ok) throw new Error(`Sofascore page returned ${sofaPage.status}`);
  if(!resultsPage.ok) throw new Error(`Results fallback returned ${resultsPage.status}`);
  return {matches:parseFallbackResults(await resultsPage.text()),standings:{standings:parseNextData(await sofaPage.text())},fallback:true};
}
function kickoff(date,time="12:00"){
  const parsed=Date.parse(`${date} ${time} GMT+0800`);
  return Number.isNaN(parsed)?date:new Date(parsed).toISOString();
}

function parseFixtures(html){
  const heading=html.search(/Liga A1 Semi-\s*Pro 2026\/2027/i);
  if(heading<0) throw new Error("AFL page did not contain the Liga A1 2026/27 section");
  const start=html.indexOf('<div class="match-list',heading);
  const end=html.indexOf('<div class="vc_separator',start);
  const section=html.slice(start,end>start?end:html.length);
  const starts=[...section.matchAll(/<div class="fixture-item"[^>]*>/g)];
  return starts.map((entry,index)=>{
    const block=section.slice(entry.index,starts[index+1]?.index??section.length);
    const teams=[...block.matchAll(/<div class="medium-font"[^>]*>([\s\S]*?)<\/div>/gi)].map(match=>({name:clean(match[1]),logo:imageFrom(match[1])}));
    const date=capture(block,/class="match-date"[^>]*>([\s\S]*?)<\/span>/i);
    const time=capture(block,/class="match-time"[^>]*>([\s\S]*?)<\/span>/i);
    const venue=capture(block,/class="match-venue"[^>]*>([\s\S]*?)<\/div>/i).replace(/^(Venue|-)\s*/i,"");
    const home=canonicalTeam(teams[0]?.name??"TBC"),away=canonicalTeam(teams[1]?.name??"TBC"),dateTime=kickoff(date,time);
    return {id:`a1-${slug(home)}-${slug(away)}-${dateTime.slice(0,10)}`,status:"scheduled",kickoff:dateTime,venue,home,away,homeScore:null,awayScore:null,homeLogo:teams[0]?.logo,awayLogo:teams[1]?.logo};
  }).filter(match=>match.home!=="TBC"&&match.away!=="TBC"&&match.kickoff.slice(0,10)>=seasonStart);
}

function parseResults(html){
  const resultsHeading=html.search(/<h2 class="title"[^>]*>\s*Results\s*<\/h2>/i);
  const relativeA1=html.slice(Math.max(0,resultsHeading)).search(/Liga A1 Semi-\s*Pro 2026\/2027/i);
  const a1Heading=Math.max(0,resultsHeading)+relativeA1;
  const sectionStart=html.indexOf('<div class="recent-result-carousel',a1Heading);
  const sectionEnd=html.indexOf('<div class="vc_separator',sectionStart);
  const section=html.slice(sectionStart,sectionEnd>sectionStart?sectionEnd:html.length);
  const starts=[...section.matchAll(/<div class="full-result result-item"[^>]*>/g)];
  return starts.map((entry,index)=>{
    const block=section.slice(entry.index,starts[index+1]?.index??section.length);
    const teams=[...block.matchAll(/<div class="today-match-team"[^>]*>([\s\S]*?)<\/div>/gi)].map(match=>({name:clean(match[1]),logo:imageFrom(match[1])}));
    const score=capture(block,/class="today-final-score"[^>]*>([\s\S]*?)<\/div>/i).match(/(\d+)\s*:\s*(\d+)/);
    const date=capture(block,/class="date"[^>]*>([\s\S]*?)<\/span>/i);
    const dateTime=kickoff(date),home=canonicalTeam(teams[0]?.name??"TBC"),away=canonicalTeam(teams[1]?.name??"TBC");
    return {id:`a1-${slug(home)}-${slug(away)}-${dateTime.slice(0,10)}`,status:"complete",kickoff:dateTime,venue:capture(block,/class="vanues"[^>]*>([\s\S]*?)<\/span>/i),home,away,homeScore:score?Number(score[1]):null,awayScore:score?Number(score[2]):null,homeLogo:teams[0]?.logo,awayLogo:teams[1]?.logo};
  }).filter(match=>match.home!=="TBC"&&match.away!=="TBC"&&match.homeScore!==null&&match.kickoff.slice(0,10)>=seasonStart);
}

async function previousMatches(){
  const snapshots=[];
  try{snapshots.push(JSON.parse(await readFile(new URL("../site/data/a1.json",import.meta.url),"utf8")))}catch{}
  try{
    const response=await fetch(`${deployedSnapshotUrl}?v=${Date.now()}`,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(10000)});
    if(response.ok) snapshots.push(await response.json());
  }catch(error){console.warn(`Previous deployed A1 snapshot unavailable: ${error.message}`)}
  return snapshots.filter(snapshot=>snapshot?.season==="2026/27"&&Array.isArray(snapshot.matches)).flatMap(snapshot=>snapshot.matches).map(match=>({...match,home:canonicalTeam(match.home),away:canonicalTeam(match.away)})).filter(match=>match.kickoff?.slice(0,10)>=seasonStart);
}

function calculateStandings(matches){
  const table=new Map();
  for(const team of tableOrder) table.set(team,{team,logo:"",played:0,won:0,drawn:0,lost:0,goalsFor:0,goalsAgainst:0,points:0,form:[]});
  for(const match of matches){
    for(const [team,logo] of [[match.home,match.homeLogo],[match.away,match.awayLogo]]){
      if(!table.has(team)) table.set(team,{team,logo:logo??"",played:0,won:0,drawn:0,lost:0,goalsFor:0,goalsAgainst:0,points:0,form:[]});
      else if(logo&&!table.get(team).logo) table.get(team).logo=logo;
    }
    if(match.status!=="complete"||!Number.isFinite(match.homeScore)||!Number.isFinite(match.awayScore)) continue;
    const home=table.get(match.home),away=table.get(match.away);
    home.played++;away.played++;home.goalsFor+=match.homeScore;home.goalsAgainst+=match.awayScore;away.goalsFor+=match.awayScore;away.goalsAgainst+=match.homeScore;
    if(match.homeScore>match.awayScore){home.won++;home.points+=3;away.lost++;home.form.push("W");away.form.push("L")}
    else if(match.homeScore<match.awayScore){away.won++;away.points+=3;home.lost++;away.form.push("W");home.form.push("L")}
    else{home.drawn++;away.drawn++;home.points++;away.points++;home.form.push("D");away.form.push("D")}
  }
  const order=new Map(tableOrder.map((team,index)=>[team,index]));
  return [...table.values()].map(row=>({...row,goalDifference:row.goalsFor-row.goalsAgainst,form:row.form.slice(-5)})).sort((a,b)=>b.points-a.points||b.goalDifference-a.goalDifference||b.goalsFor-a.goalsFor||(order.get(a.team)??999)-(order.get(b.team)??999)||a.team.localeCompare(b.team)).map((row,index)=>({...row,position:index+1}));
}

async function fetchAflNews(){
  const response=await fetch(newsUrl,{headers:{Accept:"application/json","User-Agent":"MYSL Match Centre GitHub Pages Dashboard/1.0"},signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw new Error(`AFL news returned ${response.status}`);
  const posts=await response.json();
  return (Array.isArray(posts)?posts:[]).filter(post=>post.link&&clean(post.title?.rendered)).slice(0,3).map(post=>({
    title:clean(post.title.rendered),
    excerpt:snippet(post.excerpt?.rendered),
    date:new Date(`${post.date}+08:00`).toISOString(),
    url:post.link,
    source:"AFL"
  }));
}

async function previousNews(){
  try{
    const snapshot=JSON.parse(await readFile(new URL("../site/data/a1.json",import.meta.url),"utf8"));
    return Array.isArray(snapshot.news)?snapshot.news:[];
  }catch{return []}
}

const response=await fetch(sourceUrl,{headers});
if(!response.ok) throw new Error(`AFL website returned ${response.status}`);
const html=await response.text();
const fixtures=parseFixtures(html),results=parseResults(html);
if(!fixtures.length&&!results.length) throw new Error("AFL page contained no current-season fixtures or results");

let sofaMatches=[],sofaStandings=null;
try{
  const sofa=await fetchSofaData();
  sofaMatches=sofa.matches;
  sofaStandings=sofa.standings;
  console.log(`Loaded ${sofaMatches.length} Sofascore fixtures/results for live synchronization.`);
}catch(error){
  console.warn(`Sofascore JSON feed unavailable: ${error.message}`);
  try{
    const sofa=await fetchPublishedFallback();
    sofaMatches=sofa.matches;
    sofaStandings=sofa.standings;
    console.log(`Loaded published Sofascore standings and ${sofaMatches.length} completed fallback results.`);
  }catch(fallbackError){
    console.warn(`Published live-data fallback unavailable; retaining official AFL snapshot: ${fallbackError.message}`);
  }
}

const matchesById=new Map();
for(const match of [...await previousMatches(),...fixtures,...results]){
  const id=`a1-${slug(match.home)}-${slug(match.away)}-${match.kickoff.slice(0,10)}`;
  const existing=matchesById.get(id);
  if(existing?.status==="complete"&&match.status!=="complete") continue;
  matchesById.set(id,{...existing,...match,id});
}
const aflMatches=[...matchesById.values()].sort((a,b)=>a.kickoff.localeCompare(b.kickoff));
let matches=removeSupersededFixtures(mergeSofaMatches(aflMatches,sofaMatches));
const logoByTeam=new Map(matches.flatMap(match=>[[match.home,match.homeLogo],[match.away,match.awayLogo]]).filter(([,logo])=>logo));
const publishedStandings=sofaStandings?parseSofaStandings(sofaStandings,logoByTeam):null;
if(publishedStandings?.length) matches=removeSupersededFixtures(reconcileCompletedFixtures(matches,publishedStandings));
const standings=publishedStandings?.length?publishedStandings:calculateStandings(matches);
let news=await previousNews();
try{
  const latestNews=await fetchAflNews();
  if(latestNews.length) news=latestNews;
}catch(error){console.warn(`AFL news feed unavailable; retaining the last verified updates: ${error.message}`)}

await mkdir(new URL("../site/data/",import.meta.url),{recursive:true});
await writeFile(new URL("../site/data/a1.json",import.meta.url),JSON.stringify({season:"2026/27",updatedAt:new Date().toISOString(),source:"Amateur Football League",sourceUrl,liveSource:"Sofascore",liveSourceUrl:"https://www.sofascore.com/football/tournament/malaysia/liga-a1/22740",resultsFallbackSource:"FootyStats",resultsFallbackUrl,sofascore:{tournament:sofascoreTournament,season:sofascoreSeason,urls:sofascoreUrls},refreshNote:"Live scores check every 30 seconds; AFL fixtures, venues and news refresh through GitHub Actions.",standings,news,matches},null,2)+"\n");
console.log(`Saved ${matches.length} cumulative A1 matches, ${matches.filter(match=>match.status==="complete").length} completed results, ${matches.filter(match=>match.status==="live").length} live matches, a ${standings.length}-club table and ${news.length} AFL news updates.`);
