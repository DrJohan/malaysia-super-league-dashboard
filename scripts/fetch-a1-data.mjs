import {mkdir,readFile,writeFile} from "node:fs/promises";

const sourceUrl="https://the-afl.my/";
const deployedSnapshotUrl="https://drjohan.github.io/malaysia-super-league-dashboard/data/a1.json";
const seasonStart="2026-08-28";
const headers={Accept:"text/html,application/xhtml+xml", "User-Agent":"MYSL Match Centre GitHub Pages Dashboard/1.0"};
const tableOrder=["AAK UNISEL FC","ARMED FORCES FC","BUNGA RAYA FC","IMIGRESEN FC II","JDT II","KEDAH FA","KELANTAN CITY FC","MANJUNG CITY FC","MALAYSIAN UNIVERSITY – UiTM","NEGERI SEMBILAN FC II","PERAK FA","SELANGOR FC II","UM – DAMANSARA UNITED","USM FC"];

function decode(value=""){
  return value
    .replace(/&#x([0-9a-f]+);/gi,(_,code)=>String.fromCodePoint(Number.parseInt(code,16)))
    .replace(/&#(\d+);/g,(_,code)=>String.fromCodePoint(Number(code)))
    .replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&apos;|&#039;/g,"'").replace(/&ndash;|&mdash;/g,"–").replace(/&nbsp;/g," ");
}
function clean(value=""){return decode(value.replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim()}
function capture(block,pattern){return clean(block.match(pattern)?.[1]??"")}
function imageFrom(block){return decode(block.match(/<img[^>]+src="([^"]+)"/i)?.[1]??"")}
function slug(value){return value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}
function canonicalTeam(value){
  const name=clean(value).replace(/\s*-\s*/g," – ");
  const aliases={
    "JOHOR DARUL TAZIM II":"JDT II",
    "MALAYSIAN UNIVERSITY":"MALAYSIAN UNIVERSITY – UiTM",
    "MALAYSIAN UNIVERSITY – UITM":"MALAYSIAN UNIVERSITY – UiTM",
    "UM – DAMANSARA UNITED":"UM – DAMANSARA UNITED"
  };
  return aliases[name.toUpperCase()]??name;
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

const response=await fetch(sourceUrl,{headers});
if(!response.ok) throw new Error(`AFL website returned ${response.status}`);
const html=await response.text();
const fixtures=parseFixtures(html),results=parseResults(html);
if(!fixtures.length&&!results.length) throw new Error("AFL page contained no current-season fixtures or results");

const matchesById=new Map();
for(const match of [...await previousMatches(),...fixtures,...results]){
  const id=`a1-${slug(match.home)}-${slug(match.away)}-${match.kickoff.slice(0,10)}`;
  const existing=matchesById.get(id);
  if(existing?.status==="complete"&&match.status!=="complete") continue;
  matchesById.set(id,{...existing,...match,id});
}
const matches=[...matchesById.values()].sort((a,b)=>a.kickoff.localeCompare(b.kickoff));
const standings=calculateStandings(matches);

await mkdir(new URL("../site/data/",import.meta.url),{recursive:true});
await writeFile(new URL("../site/data/a1.json",import.meta.url),JSON.stringify({season:"2026/27",updatedAt:new Date().toISOString(),source:"Amateur Football League",sourceUrl,refreshNote:"AFL results and standings refresh every five minutes when the official page changes.",standings,matches},null,2)+"\n");
console.log(`Saved ${matches.length} cumulative A1 matches, ${matches.filter(match=>match.status==="complete").length} completed results and a ${standings.length}-club table.`);
