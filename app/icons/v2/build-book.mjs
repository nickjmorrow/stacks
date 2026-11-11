import fs from 'node:fs';
// The icon-design skill's generator, from the local Claude skills folder.
const {icon} = await import(`${process.env.HOME}/.claude/skills/icon-design/references/glass.mjs`);
const W='#fff';
const rnd=(w)=>`stroke="#fff" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
// one path for both pages: the spine is a single point top and bottom, rounded by the stroke
const pages=`<path d="M40 66c32-4 64 2 88 18 24-16 56-22 88-18v122c-32-4-64 2-88 18-24-16-56-22-88-18z" fill="${W}" ${rnd(12)}/>`;
const spine=`<path d="M128 90v110" fill="none" ${rnd(9)}/>`;
const book=(id,tile)=>({id,name:id,tile,layers:[
  {kind:'white',y:[60,206],mask:pages},
  {kind:'color',c:['#EFE4D8','#E6D8CA'],y:[90,200],mask:spine}]});
export const specs=[
  book('book-a',['#FF9A3E','#C1271B']),   // amber to scarlet
  book('book-b',['#F0802F','#A8231A']),   // deeper, redder
  book('book-c',['#FFAE48','#D6401F']),   // more amber, less red
];
for(const s of specs) fs.writeFileSync(`${s.id}.svg`, icon(s,'flat'));
