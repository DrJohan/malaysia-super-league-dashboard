import {mkdir,writeFile} from "node:fs/promises";

const sourceUrl="https://the-afl.my/";
const seasonStart="2026-08-28";
const headers={Accept:"text/html,application/xhtml+xml", "User-Agent":"MYSL Match Centre GitHub Pages Dashboard/1.0"};

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
    const home=teams[0]?.name??"TBC",away=teams[1]?.name??"TBC",dateTime=kickoff(date,time);
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
    const dateTime=kickoff(date),home=teams[0]?.name??"TBC",away=teams[1]?.name??"TBC";
    return {id:`a1-${slug(home)}-${slug(away)}-${dateTime.slice(0,10)}`,status:"complete",kickoff:dateTime,venue:capture(block,/class="vanues"[^>]*>([\s\S]*?)<\/span>/i),home,away,homeScore:score?Number(score[1]):null,awayScore:score?Number(score[2]):null,homeLogo:teams[0]?.logo,awayLogo:teams[1]?.logo};
  }).filter(match=>match.home!=="TBC"&&match.away!=="TBC"&&match.homeScore!==null&&match.kickoff.slice(0,10)>=seasonStart);
}

const response=await fetch(sourceUrl,{headers});
if(!response.ok) throw new Error(`AFL website returned ${response.status}`);
const html=await response.text();
const fixtures=parseFixtures(html),results=parseResults(html);
if(!fixtures.length&&!results.length) throw new Error("AFL page contained no current-season fixtures or results");

const matchesById=new Map(fixtures.map(match=>[match.id,match]));
for(const result of results) matchesById.set(result.id,result);
const matches=[...matchesById.values()].sort((a,b)=>a.kickoff.localeCompare(b.kickoff));
const standingsSourceImage=decode(html.match(/Point Table[\s\S]{0,2500}?href="([^"]*STANDING[^"]+)"/i)?.[1]??"");
let standingsImage="";
if(standingsSourceImage){
  try{
    const imageResponse=await fetch(standingsSourceImage,{headers:{"User-Agent":headers["User-Agent"]}});
    if(imageResponse.ok){
      await mkdir(new URL("../site/data/",import.meta.url),{recursive:true});
      await writeFile(new URL("../site/data/a1-standings.jpg",import.meta.url),Buffer.from(await imageResponse.arrayBuffer()));
      standingsImage="../data/a1-standings.jpg";
    }
  }catch(error){console.warn(`AFL standings image unavailable: ${error.message}`)}
}

await mkdir(new URL("../site/data/",import.meta.url),{recursive:true});
await writeFile(new URL("../site/data/a1.json",import.meta.url),JSON.stringify({season:"2026/27",updatedAt:new Date().toISOString(),source:"Amateur Football League",sourceUrl,refreshNote:"AFL data refreshes every five minutes when the official page changes.",standingsImage:standingsImage||standingsSourceImage,standingsSourceImage,matches},null,2)+"\n");
console.log(`Saved ${fixtures.length} A1 fixtures, ${results.length} current-season results and ${standingsSourceImage?"an official standings image":"no standings image"}.`);
