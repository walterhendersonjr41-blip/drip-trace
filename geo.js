// Offline reverse geocode: nearest US city/town from bundled ZIP-centroid list. Source: github.com/millbj92/US-Zip-Codes-JSON
const C=require('./uscities.json');const G={};
for(const c of C){const k=Math.floor(c[0])+','+Math.floor(c[1]);(G[k]=G[k]||[]).push(c)}
const R=6371e3,rad=x=>x*Math.PI/180;
const dist=(a,b,c,d)=>{const x=Math.sin(rad(c-a)/2)**2+Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(rad(d-b)/2)**2;return 2*R*Math.asin(Math.sqrt(x))};
function city(lat,lng){let best=null,bd=Infinity;for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(const c of G[(Math.floor(lat)+i)+','+(Math.floor(lng)+j)]||[]){const d=dist(lat,lng,c[0],c[1]);if(d<bd){bd=d;best=c[2]}}return bd<80e3?best:null}
module.exports={city,dist};
