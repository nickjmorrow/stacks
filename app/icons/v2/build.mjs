import fs from 'node:fs';
// The icon-design skill's generator, from the local Claude skills folder.
const {icon} = await import(`${process.env.HOME}/.claude/skills/icon-design/references/glass.mjs`);
const W='#fff', K='#000';
const rnd=(w)=>`stroke="#fff" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
const book=(x,y,w,h,t='')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${W}" ${t}/>`;
// pages: a thin cut near one end so each bar reads as a book (spine + page block)
const sbook=(x,y,w,h,t='')=>book(x,y,w,h,t)+`<rect x="${x+w-26}" y="${y+8}" width="6" height="${h-16}" rx="3" fill="${K}" ${t}/>`;
const NAVY=['#22304f','#0b1120'], SUN=['#ffd95c','#ffcc33'];
const openBook=(pages,ribbon)=>[
   {kind:pages.kind,c:pages.c,y:[58,206],mask:`<path d="M124 82c-20-16-52-22-84-18v124c32-4 64 2 84 18z" fill="${W}" ${rnd(12)}/><path d="M132 82c20-16 52-22 84-18v124c-32-4-64 2-84 18z" fill="${W}" ${rnd(12)}/>`},
   {kind:'color',c:ribbon,y:[52,196],mask:`<path d="M166 56h22v140l-11-12-11 12z" fill="${W}" ${rnd(4)}/>`}];
const shelf=(c)=>[{kind:'color',c,y:[46,222],mask:`${book(48,48,40,160)}${book(96,58,40,150)}<rect x="146" y="46" width="40" height="162" rx="10" fill="${W}" transform="rotate(14 166 207)"/><rect x="40" y="206" width="176" height="16" rx="8" fill="${W}"/>`}];
export const specs = [
 // A. Stack: three closed books from the side, the top one askew. Indigo.
 {id:'stack',name:'Stack',tile:['#6366F1','#2E2A9E'],layers:[
   {kind:'white',y:[46,210],mask:`${sbook(44,160,168,50)}${sbook(52,104,164,50)}${sbook(46,50,160,50,'transform="rotate(-7 126 75)"')}`}]},
 // B. Open book with a bookmark. Mint tile, white pages, warm ribbon.
 {id:'open',name:'Open',tile:['#45E0C8','#00A898'],layers:openBook({kind:'white'},['#FFE07A','#FFB21E'])},
 // C. Shelf: two upright books and one leaning. Graphite tile, amber glyph.
 {id:'shelf',name:'Shelf',tile:['#3C3C42','#18181B'],layers:shelf(['#FFE07A','#FFB21E'])},
 // D/E. Midnight Sun variants (navy tile, sun glyph) for the themed set.
 {id:'shelf-ms',name:'Shelf MS',tile:NAVY,layers:shelf(SUN)},
 {id:'open-ms',name:'Open MS',tile:NAVY,layers:openBook({kind:'color',c:['#f4f6fb','#e3e8f2']},SUN)},
];
const dir=new URL('.', import.meta.url).pathname;
for(const s of specs) fs.writeFileSync(`${dir}/${s.id}.svg`, icon(s,'flat'));
console.log(specs.map(s=>s.id).join(' '));
