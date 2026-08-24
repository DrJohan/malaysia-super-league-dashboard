import {mkdir,writeFile} from "node:fs/promises";

const competitionId="2393";
const scheduleUrl=`https://hosted.dcd.shared.geniussports.com/embednf/MFL/en/competition/${competitionId}/schedule?phaseName=&poolNumber=0&matchType=REGULAR&roundNumber=-1&_cc=1&_nv=1&_mf=1`;
const liveUrl=`https://hosted.dcd.shared.geniussports.com/ldata/football/competitions/comp${competitionId}.json`;
const newsUrl="https://www.malaysianfootballleague.com/Content/Search/List";
const sourceUrl="https://www.malaysianfootballleague.com/Home/Sport";

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

async function fetchMflNews(){
  const body=new URLSearchParams({
    start:"0",
    length:"6",
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
  return (Array.isArray(payload.data)?payload.data:[]).filter(item=>item.ContentId&&plainText(item.ContentTitle)).slice(0,3).map(item=>({
    title:plainText(item.ContentTitle),
    excerpt:snippet(item.ContentDesc),
    date:new Date(`${item.PublishDate}Z`).toISOString(),
    url:`https://www.malaysianfootballleague.com/Content/Post/Watch/${item.ContentId}`,
    source:"MFL"
  }));
}

const response=await fetch(scheduleUrl,{headers:{Accept:"application/json","User-Agent":"MSL GitHub Pages Dashboard/1.0"}});
if(!response.ok) throw new Error(`MFL schedule returned ${response.status}`);
const payload=await response.json();
let matches=parseMatches(payload.html??"");
if(!matches.length) throw new Error("MFL schedule contained no fixtures");
try{
  const liveResponse=await fetch(liveUrl,{headers:{Accept:"application/json"}});
  if(liveResponse.ok) matches=mergeLive(matches,await liveResponse.json());
}catch(error){console.warn(`Live clock feed unavailable: ${error.message}`)}
let news=[];
try{news=await fetchMflNews()}catch(error){console.warn(`MFL news feed unavailable: ${error.message}`)}

await mkdir(new URL("../site/data/",import.meta.url),{recursive:true});
await writeFile(new URL("../site/data/league.json",import.meta.url),JSON.stringify({season:"2026/27",updatedAt:new Date().toISOString(),source:"Malaysian Football League",sourceUrl,news,matches},null,2)+"\n");
console.log(`Saved ${matches.length} fixtures (${matches.filter(match=>match.status==="live").length} live) and ${news.length} MFL news updates.`);
