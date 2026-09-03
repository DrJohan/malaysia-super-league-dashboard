import {mkdir,writeFile} from "node:fs/promises";

const competitions={
  league:{
    competitionId:"2393",
    output:"league.json",
    season:"2026/27",
    label:"Liga Super",
    sourceUrl:"https://www.malaysianfootballleague.com/Home/Sport"
  },
  "fa-cup":{
    competitionId:"2394",
    output:"fa-cup.json",
    season:"2026/27",
    label:"Malaysia FA Cup",
    sourceUrl:"https://www.malaysianfootballleague.com/Home/Sport?WHurl=%2Fcompetition%2F2394%2Fschedule",
    newsKeyword:/\bPIALA\s+FA\b/i
  }
};
const newsUrl="https://www.malaysianfootballleague.com/Content/Search/List";

const decode=(value="")=>String(value??"")
  .replace(/&#x([0-9a-f]+);/gi,(_,code)=>String.fromCodePoint(Number.parseInt(code,16)))
  .replace(/&#(\d+);/g,(_,code)=>String.fromCodePoint(Number(code)))
  .replace(/&amp;#039;|&apos;/g,"'").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&nbsp;/g," ");
const plainText=(value="")=>decode(String(value??"").replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim();
function snippet(value,maxLength=190){
  const text=plainText(value);
  if(text.length<=maxLength) return text;
  const shortened=text.slice(0,maxLength-1).replace(/\s+\S*$/,"").trim();
  return `${shortened||text.slice(0,maxLength-1).trim()}…`;
}
function textFrom(block,pattern){const match=block.match(pattern);return match?decode(match[1].replace(/<[^>]+>/g,"").trim()):""}
function scoreFrom(block,className){const value=textFrom(block,new RegExp(`${className}[\\s\\S]*?<div class="fake-cell">\\s*([^<]*)`,"i"));return /^\d+$/.test(value)?Number(value):null}
function logoFrom(block,className){return block.match(new RegExp(`${className}[\\s\\S]*?<img[^>]+src\\s*=\\s*"([^"]+)"`,"i"))?.[1]}
function parseKickoff(value){const parsed=Date.parse(`${value} GMT+0800`);return Number.isNaN(parsed)?value:new Date(parsed).toISOString()}

function parseMatches(html){
  const starts=[...html.matchAll(/<div class="match-wrap STATUS_([A-Z_]+)" id\s*=\s*"extfix_(\d+)">/g)];
  return starts.map((match,index)=>{
    const block=html.slice(match.index,starts[index+1]?.index??html.length),code=match[1];
    const status=code.includes("COMPLETE")?"complete":code.includes("POSTPONED")?"postponed":code.includes("LIVE")||code.includes("IN_PROGRESS")||code.includes("PERIODBREAK")?"live":"scheduled";
    const teams=[...block.matchAll(/<span class="team-name-full">([\s\S]*?)<\/span>/g)].map(item=>decode(item[1].replace(/<[^>]+>/g,"").trim()));
    return {id:match[2],status,kickoff:parseKickoff(textFrom(block,/match-time[\s\S]*?<span>([\s\S]*?)<\/span>/i)),venue:textFrom(block,/class="venuename">([\s\S]*?)<\/a>/i),home:teams[0]??"TBC",away:teams[1]??"TBC",homeScore:scoreFrom(block,"homescore"),awayScore:scoreFrom(block,"awayscore"),homeLogo:logoFrom(block,"home-team-logo"),awayLogo:logoFrom(block,"away-team-logo")};
  });
}

function liveLabel(match){
  if(match.status==="PERIODBREAK") return "Half-time";
  if(match.status==="INPROGRESS"){
    const minute=Math.max(1,(Number.parseInt(match.clock?.split(":")[0]??"0",10)||0)+1);
    const limit=match.period===1?45:match.period===2?90:match.period===3?105:match.period===4?120:null;
    return limit&&minute>limit?`${limit}' +${minute-limit}'`:`${minute}'`;
  }
  return "Live";
}

function mergeLive(matches,liveData){
  return matches.map(match=>{
    const live=liveData[match.id];
    if(!live) return match;
    const finished=live.status==="COMPLETE"||live.status==="FINISHED";
    return {...match,status:finished?"complete":"live",homeScore:live.scores?.["1"]??match.homeScore,awayScore:live.scores?.["2"]??match.awayScore,liveLabel:finished?"Full time":liveLabel(live),liveClock:live.clock,livePeriod:live.period,liveClockRunning:live.clockRunning===1||live.clockRunning===true,liveStatus:live.status};
  });
}

async function fetchJson(url){
  const response=await fetch(url,{headers:{Accept:"application/json","User-Agent":"MYSL Match Centre GitHub Pages Dashboard/1.0"},signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw new Error(`MFL feed returned ${response.status}`);
  return response.json();
}

function scheduleUrl(competitionId,roundNumber=-1){
  return `https://hosted.dcd.shared.geniussports.com/embednf/MFL/en/competition/${competitionId}/schedule?phaseName=&poolNumber=0&matchType=REGULAR&roundNumber=${roundNumber}&_cc=1&_nv=1&_mf=1`;
}

async function fetchMflNews(keyword){
  const body=new URLSearchParams({
    start:"0",
    length:"20",
    "ExtraSearch[CategoryId]":"1",
    "ExtraSearch[ContentTypes][0]":"1",
    "ExtraSearch[OrderBy]":"1",
    "ExtraSearch[HomeSection]":"Explore",
    "ExtraSearch[CacheSecond]":"60"
  });
  const response=await fetch(newsUrl,{
    method:"POST",
    headers:{Accept:"application/json","Content-Type":"application/x-www-form-urlencoded; charset=UTF-8","X-Requested-With":"XMLHttpRequest","User-Agent":"MYSL Match Centre GitHub Pages Dashboard/1.0"},
    body,
    signal:AbortSignal.timeout(15000)
  });
  if(!response.ok) throw new Error(`MFL news returned ${response.status}`);
  const payload=await response.json();
  const items=(Array.isArray(payload.data)?payload.data:[]).filter(item=>item.ContentId&&plainText(item.ContentTitle));
  const selected=keyword?items.filter(item=>keyword.test(`${plainText(item.ContentTitle)} ${plainText(item.ContentDesc)}`)):items;
  return selected.slice(0,3).map(item=>({
    title:plainText(item.ContentTitle),
    excerpt:snippet(item.ContentDesc),
    date:new Date(`${item.PublishDate}Z`).toISOString(),
    url:`https://www.malaysianfootballleague.com/Content/Post/Watch/${item.ContentId}`,
    source:"MFL"
  }));
}

async function fetchCompetition(config){
  const payload=await fetchJson(scheduleUrl(config.competitionId));
  let matches=parseMatches(payload.html??"");
  if(!matches.length) throw new Error(`${config.label} schedule contained no fixtures`);
  try{
    const liveData=await fetchJson(`https://hosted.dcd.shared.geniussports.com/ldata/football/competitions/comp${config.competitionId}.json`);
    matches=mergeLive(matches,liveData);
  }catch(error){console.warn(`${config.label} live clock feed unavailable: ${error.message}`)}
  let news=[];
  try{news=await fetchMflNews(config.newsKeyword)}catch(error){console.warn(`${config.label} news feed unavailable: ${error.message}`)}

  await mkdir(new URL("../site/data/",import.meta.url),{recursive:true});
  await writeFile(new URL(`../site/data/${config.output}`,import.meta.url),JSON.stringify({season:config.season,updatedAt:new Date().toISOString(),source:"Malaysian Football League",sourceUrl:config.sourceUrl,refreshNote:"Official scores check every 30 seconds; the full competition snapshot refreshes through GitHub Actions.",news,matches},null,2)+"\n");
  console.log(`Saved ${matches.length} ${config.label} fixtures (${matches.filter(match=>match.status==="live").length} live) and ${news.length} MFL news updates.`);
}

const requested=process.argv[2];
const selected=requested?[competitions[requested]]:Object.values(competitions);
if(selected.some(config=>!config)) throw new Error(`Unknown competition "${requested}". Use league or fa-cup.`);
for(const config of selected) await fetchCompetition(config);
