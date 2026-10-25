// Drip Trace — drivers report fuel drips at the pump. Equipment issue, never the driver's fault.
const express=require('express'),sharp=require('sharp'),fs=require('fs'),path=require('path'),crypto=require('crypto'),bcrypt=require('bcryptjs'),GEO=require('./geo');
const initSql=require('sql.js');
const PORT=process.env.PORT||8788,DBF=process.env.DB_PATH||path.join(__dirname,'data.sqlite'),HOLD_H=Number(process.env.HOLD_HOURS||24),CASHOUT_MIN=Number(process.env.CASHOUT_MIN||5);
const SIZES={none:{label:'No drip',sev:0},drop:{label:'A drop',sev:1},few:{label:'A few drops',sev:2},puddle:{label:'Puddle',sev:3},overflow:{label:'Overflow / splash-back',sev:4},nozzle_leak:{label:'Nozzle / hose leak',sev:4}};
const PRODUCTS=[['chain','Station-chain maintenance alerts','/chain/yr',4800],['insurer','Insurer station-risk index','/yr',18000],['enviro','Environmental spill-watch','/county/yr',9500],
 ['legal','Law firm / NGO evidence pack','/report',2500],['equip','Fuel-equipment nozzle failure census','/yr',24000],['investor','Investor ops-quality index','/yr',12000]];
let db;
function backup(){const d=path.join(path.dirname(DBF),'backups');fs.mkdirSync(d,{recursive:true});save();fs.copyFileSync(DBF,path.join(d,'data-'+new Date().toISOString().slice(0,13)+'.sqlite'));fs.readdirSync(d).sort().slice(0,-28).forEach(f=>fs.unlinkSync(path.join(d,f)))}
const save=()=>fs.writeFileSync(DBF,Buffer.from(db.export()));
const all=(q,p=[])=>{const s=db.prepare(q);s.bind(p);const r=[];while(s.step())r.push(s.getAsObject());s.free();return r};
const one=(q,p)=>all(q,p)[0];const run=(q,p=[])=>{db.run(q,p);save()};
const setting=(k,v)=>{if(v!==undefined){run('INSERT OR REPLACE INTO settings VALUES(?,?)',[k,String(v)]);return v}const r=one('SELECT v FROM settings WHERE k=?',[k]);return r&&r.v};
const mail=(to,subject,body)=>{run("INSERT INTO outbox(to_addr,subject,body,ts) VALUES(?,?,?,datetime('now'))",[to||'',subject,body]);console.log('[mail-stub]',to,subject)};
const SHARE=()=>Number(setting('user_share_pct')||70),GOAL=()=>Number(setting('pot_goal')||30000);
const POTPCT=()=>Number(setting('pot_pct')||50); // % of user share -> weekly prize pot; rest -> monthly member distribution by points
const PAYON=()=>setting('per_report_pay')==='1',RATE=()=>Number(setting('report_rate')||0.05),UCAP=()=>Number(setting('user_daily_cap')||0.50);
const NET=a=>Math.max(0,a-(a*0.029+0.30));
// ISO week key (Monday start, UTC)
const week=(d=new Date())=>{const t=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));const day=(t.getUTCDay()+6)%7;t.setUTCDate(t.getUTCDate()-day);return t.toISOString().slice(0,10)};
const prevWeek=w=>{const t=new Date(w+'T00:00:00Z');t.setUTCDate(t.getUTCDate()-7);return t.toISOString().slice(0,10)};
function money(){const rev=all("SELECT amount FROM orders WHERE status='paid'"),net=rev.reduce((a,o)=>a+NET(o.amount||0),0),share=net*SHARE()/100;
  const prizes=one("SELECT COALESCE(SUM(prize_value),0) v FROM draws WHERE winner IS NOT NULL").v,perRep=one("SELECT COALESCE(SUM(payout),0) v FROM reports WHERE verified=1 AND engine!='demo'").v,sponsorFunded=one("SELECT COALESCE(SUM(prize_value),0) v FROM draws WHERE winner IS NOT NULL AND sponsored=1").v;
  const potPct=POTPCT()/100,dist=one('SELECT COALESCE(SUM(amount),0) v FROM dividends').v;
  const pot=Math.max(0,share*potPct-(prizes-sponsorFunded)-perRep),memberPool=Math.max(0,share*(1-potPct)-dist);
  return {revenue:+rev.reduce((a,o)=>a+(o.amount||0),0).toFixed(2),net:+net.toFixed(2),share:SHARE(),userShare:+share.toFixed(2),operatorShare:+(net-share).toFixed(2),
    prizesAwarded:+prizes.toFixed(2),perReportPaid:+perRep.toFixed(2),pot:+pot.toFixed(2),potPct:POTPCT(),memberPool:+memberPool.toFixed(2),distributed:+dist.toFixed(2),goal:GOAL(),pct:+Math.min(100,pot/GOAL()*100).toFixed(1),
    paidOut:one('SELECT COALESCE(SUM(amount),0) v FROM payouts').v}}

// ---- vision: Grok (xAI) or labeled mock ----
async function classify(jpeg,claim){
  if(process.env.XAI_API_KEY){
    const r=await fetch('https://api.x.ai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.XAI_API_KEY},
      body:JSON.stringify({model:process.env.XAI_VISION_MODEL||'grok-4',temperature:0,response_format:{type:'json_object'},messages:[{role:'user',content:[
       {type:'image_url',image_url:{url:'data:image/jpeg;base64,'+jpeg.toString('base64'),detail:'high'}},
       {type:'text',text:'This photo should show a gas-pump nozzle, hose, pump base or the ground beside a vehicle fuel filler at a gas station. Answer JSON only: {"fuel_pump_scene":bool,"visible_fuel":bool,"size":"none|drop|few|puddle|overflow|nozzle_leak","confidence":0-1}. visible_fuel = liquid fuel drips/wetness/sheen visible.'}]}]})});
    if(!r.ok)throw new Error('xAI '+r.status);const j=await r.json();const o=JSON.parse(j.choices[0].message.content.replace(/```json|```/g,''));
    return {scene:!!o.fuel_pump_scene,fuel:!!o.visible_fuel,size:SIZES[o.size]?o.size:null,confidence:o.confidence??null,engine:'xai'}}
  const h=crypto.createHash('md5').update(jpeg).digest()[0]; // MOCK — not real detection
  return {scene:h>20,fuel:claim!=='none',size:claim,confidence:0.9,engine:'mock'}}
async function dhash(buf){const px=await sharp(buf).greyscale().resize(9,8,{fit:'fill'}).raw().toBuffer();let b='';for(let y=0;y<8;y++)for(let x=0;x<8;x++)b+=px[y*9+x]<px[y*9+x+1]?1:0;return b}
const ham=(a,b)=>{if(!a||a.length!==b.length)return 99;let d=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])d++;return d};
async function stripe(p,params,method='POST'){const k=process.env.STRIPE_SECRET_KEY;if(!k)return null;
  const r=await fetch('https://api.stripe.com/v1/'+p,method==='GET'?{headers:{Authorization:'Bearer '+k}}:{method,headers:{Authorization:'Bearer '+k,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params)});
  const j=await r.json();if(j.error)throw new Error(j.error.message);return j}

const app=express();
app.post('/api/stripe/webhook',express.raw({type:'*/*'}),(req,res)=>{const sec=process.env.STRIPE_WEBHOOK_SECRET;if(!sec)return res.status(400).end();
  const sig=Object.fromEntries((req.get('stripe-signature')||'').split(',').map(x=>x.split('=')));
  if(crypto.createHmac('sha256',sec).update(sig.t+'.'+req.body).digest('hex')!==sig.v1)return res.status(400).end('bad sig');
  const ev=JSON.parse(req.body);if(ev.type==='checkout.session.completed'&&one('SELECT 1 x FROM sq WHERE session=?',[ev.data.object.id])){const o=ev.data.object;
    run("UPDATE sq SET status='paid',amount=? WHERE session=?",[(o.amount_total||0)/100,o.id]);run("INSERT INTO orders(product,session,status,ts,email,amount) VALUES('sponsored_question',?,'paid',datetime('now'),?,?)",[o.id,o.customer_details?.email||'',(o.amount_total||0)/100]);
    mail(process.env.OPERATOR_EMAIL||'operator','Sponsored question paid — needs approval',o.id);return res.json({ok:1})}
  if(ev.type==='checkout.session.completed'){const o=ev.data.object;run("UPDATE orders SET status='paid',email=?,amount=? WHERE session=?",[o.customer_details?.email||'',(o.amount_total||0)/100,o.id]);
    const key='dt_'+crypto.randomBytes(18).toString('hex');run("INSERT INTO apikeys VALUES(?,?,datetime('now'))",[key,o.customer_details?.email||o.id]);mail(o.customer_details?.email,'Drip Trace receipt + API key','API key: '+key)}
  res.json({ok:1})});
app.use(express.json({limit:'8mb'}));app.use(express.static(path.join(__dirname,'public')));
const user=(req,res,next)=>{const u=one('SELECT * FROM users WHERE token=?',[req.get('x-token')||'']);if(!u)return res.status(401).json({error:'sign in'});req.u=u;next()};
const admin=(req,res,next)=>{const t=process.env.ADMIN_TOKEN;if(!t||req.get('x-admin')!==t)return res.status(401).json({error:'admin token required (set ADMIN_TOKEN)'});next()};

// ---- auth: username+password (bcrypt) + SMS verify stub, one account per phone ----
const uname=x=>String(x||'').trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
const phoneNorm=x=>{const d=String(x||'').replace(/\D/g,'').replace(/^1(?=\d{10}$)/,'');return d.length===10?'+1'+d:null};
app.post('/api/register',async(req,res)=>{const n=uname(req.body.username),pw=String(req.body.password||''),ph=phoneNorm(req.body.phone);
  if(n.length<2)return res.status(400).json({error:'username 2+ chars'});if(pw.length<8)return res.status(400).json({error:'password 8+ chars'});
  if(!ph)return res.status(400).json({error:'US mobile number required'});if(!req.body.agree18)return res.status(400).json({error:'Confirm you are 18+ in the US and accept the terms'});
  if(one('SELECT 1 x FROM users WHERE name=?',[n]))return res.status(409).json({error:'username taken'});
  if(one('SELECT 1 x FROM users WHERE phone=?',[ph]))return res.status(409).json({error:'That phone number already has an account'});
  const code=String(crypto.randomInt(100000,1000000)),tok=crypto.randomBytes(24).toString('hex');
  run('INSERT INTO users(name,token,pass_hash,phone,phone_verified,sms_code) VALUES(?,?,?,?,0,?)',[n,tok,bcrypt.hashSync(pw,10),ph,code]);mail(ph,'SMS','Drip Trace code: '+code); // SMS stub
  res.json({token:tok,name:n,needVerify:true,...(process.env.SMS_PROVIDER?{}:{devCode:code})})});
app.post('/api/login',(req,res)=>{const u=one('SELECT * FROM users WHERE name=?',[uname(req.body.username)]);
  if(!u||!u.pass_hash||!bcrypt.compareSync(String(req.body.password||''),u.pass_hash))return res.status(401).json({error:'wrong username or password'});res.json({token:u.token,name:u.name,needVerify:!u.phone_verified})});
app.post('/api/verify-phone',user,(req,res)=>{if(String(req.body.code)!==req.u.sms_code)return res.status(400).json({error:'wrong code'});run('UPDATE users SET phone_verified=1,sms_code=NULL WHERE id=?',[req.u.id]);res.json({ok:1})});

app.get('/api/config',(q,r)=>r.json({sqPrice:SQ_PRICE(),sizes:SIZES,vision:process.env.XAI_API_KEY?'xai':'mock',stripe:!!process.env.STRIPE_SECRET_KEY,perReportPay:PAYON(),rate:RATE(),userCap:UCAP(),cashoutMin:CASHOUT_MIN,holdHours:HOLD_H,
  share:SHARE(),prize:prizeFor(drawWeek()),sponsor:setting('sponsor_name')?{name:setting('sponsor_name'),logo:setting('sponsor_logo')||'',link:setting('sponsor_link')||''}:null,week:week()}));
app.get('/api/transparency',(q,r)=>r.json(money()));
app.get('/api/stations/near',(q,r)=>{const lat=+q.query.lat,lng=+q.query.lng;if(!isFinite(lat))return r.status(400).json({error:'lat/lng'});
  r.json(all('SELECT id,name,brand,lat,lng,addr FROM stations WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?',[lat-.05,lat+.05,lng-.06,lng+.06]).map(s=>({...s,m:Math.round(GEO.dist(lat,lng,s.lat,s.lng))})).sort((a,b)=>a.m-b.m).slice(0,10))});

app.post('/api/report',user,async(req,res)=>{
  const {image,lat,lng,station_id,size}=req.body,pump=String(req.body.pump||'').replace(/[^0-9A-Za-z]/g,'').slice(0,4);
  if(typeof lat!=='number'||typeof lng!=='number')return res.status(400).json({error:'GPS required'});
  if(!req.u.phone_verified)return res.status(403).json({error:'Verify your phone number first'});
  if(!SIZES[size])return res.status(400).json({error:'Pick a drip size (or "No drip")'});if(!pump)return res.status(400).json({error:'Enter the pump number'});
  const st=one('SELECT * FROM stations WHERE id=?',[Number(station_id)]);if(!st)return res.status(400).json({error:'Pick a station'});
  const m=GEO.dist(lat,lng,st.lat,st.lng);if(m>75)return res.status(400).json({error:`You're ${Math.round(m)} m from ${st.name}. Reports must be made at the pump (within 75 m).`});
  if(one("SELECT 1 x FROM reports WHERE user_id=? AND station_id=? AND ts>datetime('now','-4 hours')",[req.u.id,st.id]))return res.status(429).json({error:'One report per station every 4 hours'});
  if(one("SELECT COUNT(*) n FROM reports WHERE user_id=? AND ts>datetime('now','-10 minutes')",[req.u.id]).n>=3)return res.status(429).json({error:'Slow down: 3 reports per 10 min'});
  let buf=Buffer.from(String(image||'').split(',').pop(),'base64');
  try{if(buf.length<500)return res.status(400).json({error:'Photo of the nozzle/pump required'});
    buf=await sharp(buf).rotate().resize(768,768,{fit:'inside'}).jpeg({quality:80}).toBuffer();const h=await dhash(buf);
    if(all("SELECT phash FROM reports WHERE ts>datetime('now','-14 day')").some(r=>ham(r.phash,h)<=4))return res.status(409).json({error:'Duplicate photo rejected'});
    const v=await classify(buf,size),flags=[];
    if(v.engine!=='xai')flags.push('mock-engine');if(!v.scene)flags.push('not-a-pump-photo');
    if(v.engine==='xai'&&(size==='none')===v.fuel)flags.push('photo-disagrees-with-size');
    if(v.confidence!=null&&v.confidence<0.7)flags.push('low-confidence');
    if(typeof req.body.acc==='number'&&req.body.acc>50)flags.push('gps-accuracy>50m');
    const verified=flags.length?0:1;
    const earned=one("SELECT COALESCE(SUM(payout),0) v FROM reports WHERE user_id=? AND date(ts)=date('now') AND verified>=0",[req.u.id]).v;
    const pay=PAYON()?+Math.max(0,Math.min(RATE(),UCAP()-earned)).toFixed(2):0;
    run("INSERT INTO reports(user_id,station_id,pump,size,sev,ts,lat,lng,engine,verified,flags,phash,payout,ai_size) VALUES(?,?,?,?,?,datetime('now'),?,?,?,?,?,?,?,?)",
      [req.u.id,st.id,pump,size,SIZES[size].sev,lat,lng,v.engine,verified,flags.join(','),h,pay,v.size]);
    res.json({ok:1,station:st.name,brand:st.brand,pump,size:SIZES[size].label,status:verified?'verified':'in review',flags,engine:v.engine,payout:pay,utc:new Date().toISOString(),entered:verified?true:'after review'});
  }catch(e){res.status(500).json({error:e.message})}finally{buf.fill(0);buf=null}}); // image discarded, never stored

// ---- ledger / payouts (per-report pay is optional, default off) ----
app.get('/api/ledger',user,(req,res)=>{const w=week();
  const rows=all('SELECT r.ts,s.name station,r.pump,r.size,r.verified,r.flags,r.payout FROM reports r JOIN stations s ON s.id=r.station_id WHERE r.user_id=? ORDER BY r.id DESC LIMIT 100',[req.u.id]);
  const s=one(`SELECT COALESCE(SUM(CASE WHEN verified=1 THEN payout END),0) v,COALESCE(SUM(CASE WHEN verified=1 AND ts<=datetime('now','-${HOLD_H} hours') THEN payout END),0) w FROM reports WHERE user_id=?`,[req.u.id]);
  const dv=one('SELECT COALESCE(SUM(amount),0) v FROM dividends WHERE user_id=?',[req.u.id]).v;s.w+=dv;
  const out=one('SELECT COALESCE(SUM(amount),0) p FROM payouts WHERE user_id=?',[req.u.id]).p,won=all('SELECT week,prize FROM draws WHERE winner=?',[req.u.id]);
  res.json({name:req.u.name,rows,verified:s.v,available:+(s.w-out).toFixed(2),paidOut:out,entered:entered(w).some(e=>e.id===req.u.id),amoeUsed:!!one('SELECT 1 x FROM amoe WHERE user_id=? AND week=?',[req.u.id,w]),won,connected:!!req.u.stripe_acct})});
app.post('/api/amoe',user,(q,r)=>{const w=week();if(one('SELECT 1 x FROM amoe WHERE user_id=? AND week=?',[q.u.id,w]))return r.status(400).json({error:'Free entry already used this week'});run('INSERT INTO amoe(user_id,week) VALUES(?,?)',[q.u.id,w]);r.json({ok:1})});
app.post('/api/connect',user,async(req,res)=>{try{if(!process.env.STRIPE_SECRET_KEY)return res.status(503).json({error:'Payouts not configured yet'});
  let a=req.u.stripe_acct;if(!a){a=(await stripe('accounts',{type:'express','capabilities[transfers][requested]':'true'})).id;run('UPDATE users SET stripe_acct=? WHERE id=?',[a,req.u.id])}
  const base=process.env.BASE_URL||`http://localhost:${PORT}`;res.json({url:(await stripe('account_links',{account:a,type:'account_onboarding',refresh_url:base+'/#ledger',return_url:base+'/#ledger'})).url})}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/cashout',user,async(req,res)=>{try{
  const s=one(`SELECT COALESCE(SUM(payout),0) v FROM reports WHERE user_id=? AND verified=1 AND ts<=datetime('now','-${HOLD_H} hours')`,[req.u.id]).v+one('SELECT COALESCE(SUM(amount),0) v FROM dividends WHERE user_id=?',[req.u.id]).v-one('SELECT COALESCE(SUM(amount),0) p FROM payouts WHERE user_id=?',[req.u.id]).p;
  if(setting('payouts_paused')==='1')return res.status(400).json({error:'Payouts are paused'});if(s<CASHOUT_MIN)return res.status(400).json({error:`Minimum cashout $${CASHOUT_MIN}`});
  if(!req.u.stripe_acct)return res.status(400).json({error:'Connect a payout account first'});
  const ext=await stripe('accounts/'+req.u.stripe_acct+'/external_accounts?limit=10',null,'GET');const fps=(ext.data||[]).map(x=>x.fingerprint).filter(Boolean);
  if(!fps.length)return res.status(400).json({error:'Finish Stripe onboarding first'});
  if(all('SELECT bank_fp FROM users WHERE id!=? AND bank_fp IS NOT NULL',[req.u.id]).some(r=>fps.includes(r.bank_fp))){run("UPDATE users SET flagged='shared-payout-account' WHERE id=?",[req.u.id]);return res.status(409).json({error:'That payout account is linked to another account'})}
  run('UPDATE users SET bank_fp=? WHERE id=?',[fps[0],req.u.id]);
  if(one("SELECT COALESCE(SUM(amount),0) p FROM payouts WHERE ts>datetime('now','start of day')").p+s>Number(setting('daily_cap')||200))return res.status(503).json({error:'Daily payout budget reached'});
  const t=await stripe('transfers',{amount:String(Math.floor(s*100)),currency:'usd',destination:req.u.stripe_acct});
  run("INSERT INTO payouts(user_id,amount,ref,ts) VALUES(?,?,?,datetime('now'))",[req.u.id,Math.floor(s*100)/100,t.id]);res.json({ok:1,amount:s})}catch(e){res.status(500).json({error:e.message})}});

// ---- weekly live draw: commit-reveal, one entry per verified reporter (or AMOE) per week ----
const entered=w=>{const end=new Date(Date.parse(w+'T00:00:00Z')+7*864e5).toISOString().slice(0,10);
  return all(`SELECT u.id,u.name FROM users u WHERE u.flagged IS NULL AND (u.id IN (SELECT user_id FROM reports WHERE verified=1 AND engine!='demo' AND date(ts)>=? AND date(ts)<?) OR u.id IN (SELECT user_id FROM amoe WHERE week=?)) ORDER BY u.id`,[w,end,w])};
const mask=n=>n.slice(0,2)+'•••'+n.slice(-1);
const drawWeek=()=>prevWeek(week()); // the live draw on week N picks from week N-1 entrants
app.get('/api/draw',(q,r)=>{const w=q.query.week||drawWeek(),d=one('SELECT * FROM draws WHERE week=?',[w]),e=entered(w);
  const last=one('SELECT d.week,u.name FROM draws d JOIN users u ON u.id=d.winner WHERE d.winner IS NOT NULL ORDER BY d.week DESC LIMIT 1');
  r.json({week:w,entries:e.map(x=>mask(x.name)),count:e.length,commit:d?.commit_hash||null,done:!!d?.winner,winner:d?.winner?mask(one('SELECT name FROM users WHERE id=?',[d.winner]).name):null,winnerIndex:d?.idx??null,
    seed:d?.winner?d.seed:null,entriesHash:d?.entries_hash||null,prize:d?.prize||prizeFor(w),lastWinner:last?{week:last.week,name:mask(last.name)}:null})});
app.post('/api/draw/commit',admin,(q,r)=>{const w=q.body.week||drawWeek();if(one('SELECT 1 x FROM draws WHERE week=?',[w]))return r.json({ok:1,already:true});
  const seed=crypto.randomBytes(32).toString('hex');run('INSERT INTO draws(week,seed,commit_hash,ts) VALUES(?,?,?,datetime(\'now\'))',[w,seed,crypto.createHash('sha256').update(seed).digest('hex')]);r.json({ok:1})});
app.post('/api/draw/pick',admin,(q,r)=>{const w=q.body.week||drawWeek(),d=one('SELECT * FROM draws WHERE week=?',[w]);if(!d)return r.status(400).json({error:'Publish the commitment first'});if(d.winner)return r.status(400).json({error:'Already drawn'});
  const e=entered(w);if(!e.length)return r.status(400).json({error:'No entries'});
  const list=e.map(x=>x.id).join(','),eh=crypto.createHash('sha256').update(list).digest('hex');
  const idx=Number(BigInt('0x'+crypto.createHmac('sha256',Buffer.from(d.seed,'hex')).update(list).digest('hex'))%BigInt(e.length));
  const prize=prizeFor(w),val=Number(setting('prize_value')||100),sp=setting('sponsor_name')?1:0;
  run('UPDATE draws SET winner=?,idx=?,entries_hash=?,entries_list=?,prize=?,prize_value=?,sponsored=? WHERE week=?',[e[idx].id,idx,eh,list,prize,val,sp,w]);
  mail(e[idx].name,'You won the Drip Trace weekly draw!',`Week of ${w}: ${prize}. Reply within 7 days to claim.`);
  r.json({winner:mask(e[idx].name),index:idx,count:e.length,seed:d.seed,commit:d.commit_hash,entriesHash:eh})});
app.get('/api/draws',(q,r)=>r.json(all('SELECT week,commit_hash AS "commit",seed,entries_hash,entries_list,idx,prize,ts FROM draws WHERE winner IS NOT NULL ORDER BY week DESC LIMIT 52')));

// ---- member points: share of the monthly member distribution (NOT equity/securities) ----
const PTS_REPORT=10,PTS_ANSWER=2;const ym=(d=new Date())=>d.toISOString().slice(0,7);
const pointsFor=m=>all(`SELECT u.id,u.name,u.flagged,COALESCE(r.n,0)*${PTS_REPORT}+COALESCE(a.n,0)*${PTS_ANSWER} p FROM users u
  LEFT JOIN (SELECT user_id,COUNT(*) n FROM reports WHERE verified=1 AND engine!='demo' AND strftime('%Y-%m',ts)=? GROUP BY user_id) r ON r.user_id=u.id
  LEFT JOIN (SELECT user_id,COUNT(*) n FROM answers WHERE substr(day,1,7)=? GROUP BY user_id) a ON a.user_id=u.id WHERE u.flagged IS NULL`,[m,m]).filter(x=>x.p>0);
app.get('/api/stake',user,(q,r)=>{const m=ym(),P=pointsFor(m),tot=P.reduce((a,x)=>a+x.p,0),me=(P.find(x=>x.id===q.u.id)||{p:0}).p,M=money();
  r.json({month:m,points:me,totalPoints:tot,pct:tot?+(me/tot*100).toFixed(2):0,memberPool:M.memberPool,estimate:tot?+(M.memberPool*me/tot).toFixed(2):0,
    received:one('SELECT COALESCE(SUM(amount),0) v FROM dividends WHERE user_id=?',[q.u.id]).v,rules:{report:PTS_REPORT,answer:PTS_ANSWER}})});
app.post('/api/admin/distribute',admin,(q,r)=>{const now=new Date();now.setUTCDate(1);now.setUTCMonth(now.getUTCMonth()-1);const m=q.body.month||ym(now);
  if(one('SELECT 1 x FROM dividends WHERE month=?',[m]))return r.json({error:'Already distributed '+m});const P=pointsFor(m),tot=P.reduce((a,x)=>a+x.p,0),pool=money().memberPool;
  if(!tot||pool<1)return r.json({month:m,paid:0,note:'nothing to distribute'});let paid=0;
  P.forEach(x=>{const a=Math.floor(pool*x.p/tot*100)/100;if(a>0){run("INSERT INTO dividends(user_id,month,amount,ts) VALUES(?,?,?,datetime('now'))",[x.id,m,a]);paid+=a}});r.json({month:m,paid:+paid.toFixed(2),members:P.length})});

// ---- daily question (optional; never required for entries) ----
const today=()=>new Date().toISOString().slice(0,10);
const qToday=()=>one('SELECT * FROM questions WHERE day<=? ORDER BY day DESC LIMIT 1',[today()]);
app.get('/api/question',(q,r)=>{const x=qToday();if(!x)return r.json(null);const tok=q.get('x-token'),u=tok&&one('SELECT id FROM users WHERE token=?',[tok]);
  r.json({id:x.id,text:x.text,sponsor:x.sponsor||null,options:JSON.parse(x.options),answered:u?!!one('SELECT 1 x FROM answers WHERE user_id=? AND qid=?',[u.id,x.id]):false})});
app.post('/api/answer',user,(q,r)=>{const x=qToday();if(!x||x.id!==Number(q.body.qid))return r.status(400).json({error:'no active question'});const o=JSON.parse(x.options),i=Number(q.body.opt);
  if(!(i>=0&&i<o.length))return r.status(400).json({error:'bad option'});if(one('SELECT 1 x FROM answers WHERE user_id=? AND qid=?',[q.u.id,x.id]))return r.status(400).json({error:'already answered'});
  run('INSERT INTO answers(user_id,qid,opt,day) VALUES(?,?,?,?)',[q.u.id,x.id,i,today()]);r.json({ok:1,points:PTS_ANSWER})});
app.post('/api/admin/question',admin,(q,r)=>{const o=(q.body.options||[]).map(String).filter(Boolean);if(!q.body.text||o.length<2)return r.status(400).json({error:'text + 2-6 options'});
  run('INSERT INTO questions(day,text,options) VALUES(?,?,?)',[q.body.day||today(),String(q.body.text),JSON.stringify(o.slice(0,6))]);r.json({ok:1})});
const qAgg=()=>all('SELECT id,day,text,options FROM questions WHERE sq_id IS NULL ORDER BY id DESC LIMIT 10').map(x=>{const o=JSON.parse(x.options),c=all('SELECT opt,COUNT(*) n FROM answers WHERE qid=? GROUP BY opt',[x.id]);
  const t=c.reduce((a,y)=>a+y.n,0);return {day:x.day,text:x.text,n:t,results:o.map((name,i)=>({name,n:(c.find(y=>y.opt===i)||{}).n||0}))}}).filter(x=>x.n>=(Number(process.env.MIN_AGG)||1));

// ---- sponsored questions: businesses/researchers buy the daily slot; operator approves; anonymous aggregate report ----
const SQ_PRICE=()=>Number(setting('sq_price')||250);
const BAD=/\b(name|phone|email|address|ssn|social security|birth|password|license plate|where do you live)\b/i;
app.post('/api/sponsor-question',async(req,res)=>{const b=req.body,o=(b.options||[]).map(x=>String(x).trim()).filter(Boolean).slice(0,6);
  if(!/.+@.+\..+/.test(b.email||'')||!b.org)return res.status(400).json({error:'organization + email required'});
  if(!b.text||String(b.text).length>160||o.length<2)return res.status(400).json({error:'question (≤160 chars) + 2–6 answer options'});
  if(BAD.test(b.text+' '+o.join(' ')))return res.status(400).json({error:'Questions may not ask for personal or identifying information'});
  const key=crypto.randomBytes(12).toString('hex');
  run("INSERT INTO sq(org,email,text,options,day,status,report_key,ts) VALUES(?,?,?,?,?,'awaiting_payment',?,datetime('now'))",[b.org,b.email,String(b.text),JSON.stringify(o),b.day||'',key]);
  const id=one('SELECT MAX(id) i FROM sq').i;
  if(!process.env.STRIPE_SECRET_KEY)return res.status(503).json({error:'Saved (#'+id+'), but checkout is not configured yet — no charge made. We will email you a payment link.',id});
  try{const base=process.env.BASE_URL||`http://localhost:${PORT}`;const ss=await stripe('checkout/sessions',{mode:'payment','line_items[0][quantity]':'1','line_items[0][price_data][currency]':'usd',
    'line_items[0][price_data][unit_amount]':String(SQ_PRICE()*100),'line_items[0][price_data][product_data][name]':'Drip Trace Sponsored Daily Question (1 day)',customer_email:b.email,success_url:base+'/#ask?paid=1',cancel_url:base+'/#ask'});
    run('UPDATE sq SET session=? WHERE id=?',[ss.id,id]);res.json({url:ss.url})}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/admin/sq',admin,(q,r)=>r.json(all('SELECT id,org,email,text,options,day,status,amount,report_key,ts FROM sq ORDER BY id DESC LIMIT 50')));
app.post('/api/admin/sq',admin,(q,r)=>{const x=one('SELECT * FROM sq WHERE id=?',[+q.body.id]);if(!x)return r.status(404).json({error:'no request'});
  if(!q.body.approve){run("UPDATE sq SET status='rejected' WHERE id=?",[x.id]);mail(x.email,'Your Drip Trace question','Not approved — refund issued if paid.');return r.json({ok:1})}
  if(x.status!=='paid'&&!q.body.force)return r.status(400).json({error:'Not paid yet (use force for comped/invoiced)'});
  const day=q.body.day||x.day||new Date(Date.now()+864e5).toISOString().slice(0,10);
  run('INSERT INTO questions(day,text,options,sponsor,sq_id) VALUES(?,?,?,?,?)',[day,x.text,x.options,x.org,x.id]);run("UPDATE sq SET status='scheduled',day=? WHERE id=?",[day,x.id]);
  mail(x.email,'Your question is scheduled',`Runs ${day}. Anonymous results: ${(process.env.BASE_URL||'')}/sq/${x.report_key}`);r.json({ok:1,day})});
app.get('/sq/:key',(q,r)=>{const x=one('SELECT * FROM sq WHERE report_key=?',[q.params.key]);if(!x)return r.status(404).send('not found');
  const qq=one('SELECT id,day FROM questions WHERE sq_id=?',[x.id]),o=JSON.parse(x.options),c=qq?all('SELECT opt,COUNT(*) n FROM answers WHERE qid=? GROUP BY opt',[qq.id]):[],t=c.reduce((a,y)=>a+y.n,0);
  r.send(`<!doctype html><meta name=viewport content="width=device-width"><title>Sponsored question results</title><body style="font:15px system-ui;max-width:700px;margin:auto;padding:20px"><h1>${x.text.replace(/</g,'&lt;')}</h1><p>Sponsor: ${x.org.replace(/</g,'&lt;')} · Ran: ${qq?qq.day:'not yet'} · Status: ${x.status} · Responses: ${t}</p>
  ${t<10?'<p>Results appear once at least 10 members have answered (to protect anonymity).</p>':`<table>${o.map((n,i)=>{const k=(c.find(y=>y.opt===i)||{}).n||0;return `<tr><td>${n.replace(/</g,'&lt;')}</td><td>${k}</td><td>${(100*k/t).toFixed(1)}%</td></tr>`}).join('')}</table>`}<p style="color:#666">Anonymous aggregate only. No names, phone numbers, locations, or individual answers are shared.</p>`)});

// ---- community prize vote (weekly; one vote per entered member) ----
const opts=()=>{try{return JSON.parse(setting('prize_options'))}catch(e){return['$100 gas card','$100 grocery card','Free oil change + car wash']}};
const tally=w=>{const v=all('SELECT opt,COUNT(*) n FROM pvotes WHERE week=? GROUP BY opt',[w]);return opts().map((name,i)=>({i,name,n:(v.find(x=>x.opt===i)||{}).n||0}))};
const prizeFor=w=>{const t=tally(prevWeek(w)).sort((a,b)=>b.n-a.n);return t[0]&&t[0].n?t[0].name:(setting('prize')||'$100 gas card')};
app.get('/api/prize-vote',(q,r)=>{const tok=q.get('x-token'),u=tok&&one('SELECT id FROM users WHERE token=?',[tok]),w=week();
  r.json({week:w,thisWeekPrize:prizeFor(drawWeek()),tally:tally(w),canVote:u?entered(w).some(e=>e.id===u.id):false,voted:u?(one('SELECT opt FROM pvotes WHERE user_id=? AND week=?',[u.id,w])||{opt:null}).opt:null})});
app.post('/api/prize-vote',user,(q,r)=>{const w=week(),i=Number(q.body.opt);if(!entered(w).some(e=>e.id===q.u.id))return r.status(403).json({error:'Make one verified report this week to vote'});
  if(!(i>=0&&i<opts().length))return r.status(400).json({error:'bad option'});if(one('SELECT 1 x FROM pvotes WHERE user_id=? AND week=?',[q.u.id,w]))return r.status(400).json({error:'Already voted this week'});
  run('INSERT INTO pvotes(user_id,week,opt) VALUES(?,?,?)',[q.u.id,w,i]);r.json({ok:1,tally:tally(w)})});

// ---- buyer desk ----
const rateRows=(group,where='')=>all(`SELECT ${group} k,COUNT(*) n,SUM(sev>0) drips,ROUND(100.0*SUM(sev>0)/COUNT(*),1) rate,ROUND(AVG(sev),2) sev FROM reports r JOIN stations s ON s.id=r.station_id WHERE r.verified>=0 ${where} GROUP BY ${group} HAVING n>=5 ORDER BY rate DESC`);
app.get('/api/desk',(q,r)=>{const t=one("SELECT COUNT(*) n,SUM(sev>0) d,COUNT(DISTINCT station_id) st,COUNT(DISTINCT user_id) u FROM reports WHERE verified>=0");
  r.json({totals:t,demo:one("SELECT COUNT(*) n FROM reports WHERE engine='demo'").n,
    brands:rateRows("COALESCE(NULLIF(s.brand,''),'Unbranded')"),stations:rateRows("s.id||'|'||s.name||'|'||s.brand").slice(0,15),
    map:all("SELECT s.id,s.lat,s.lng,s.name,COUNT(*) n,ROUND(100.0*SUM(sev>0)/COUNT(*),1) rate FROM reports r JOIN stations s ON s.id=r.station_id WHERE r.verified>=0 GROUP BY s.id"),
    trend:all("SELECT date(ts,'weekday 1','-7 days') w,COUNT(*) n,ROUND(100.0*SUM(sev>0)/COUNT(*),1) rate FROM reports WHERE verified>=0 GROUP BY w ORDER BY w"),
    sizes:all("SELECT size,COUNT(*) n FROM reports WHERE verified>=0 GROUP BY size"),bbox:{s:34.4,w:-85.7,n:35.3,e:-84.6},
    products:PRODUCTS.map(([id,name,unit,price])=>({id,name,unit,price})),questions:qAgg()})});
app.get('/api/station/:id',(q,r)=>{const s=one('SELECT * FROM stations WHERE id=?',[+q.params.id]);if(!s)return r.status(404).json({error:'no station'});
  r.json({station:s,pumps:all("SELECT pump,COUNT(*) n,ROUND(100.0*SUM(sev>0)/COUNT(*),1) rate,SUM(size='nozzle_leak') leaks FROM reports WHERE station_id=? AND verified>=0 GROUP BY pump ORDER BY CAST(pump AS INT)",[s.id])})});
app.post('/api/checkout',async(req,res)=>{try{const base=process.env.BASE_URL||`http://localhost:${PORT}`;
  if(!process.env.STRIPE_SECRET_KEY)return res.status(503).json({error:'Checkout not configured yet (STRIPE_SECRET_KEY missing). No charge made.'});
  let li,mode='payment';if(req.body.product==='starter'){mode='subscription';li={'line_items[0][price_data][unit_amount]':'4900','line_items[0][price_data][recurring][interval]':'month','line_items[0][price_data][product_data][name]':'Drip Trace Local Starter (1 metro, monthly CSV)'}}
  else{const p=PRODUCTS.find(x=>x[0]===req.body.product);if(!p)return res.status(404).json({error:'no product'});li={'line_items[0][price_data][unit_amount]':String(p[3]*100),'line_items[0][price_data][product_data][name]':'Drip Trace — '+p[1]+' ('+p[2]+')'}}
  const s=await stripe('checkout/sessions',{mode,'line_items[0][quantity]':'1','line_items[0][price_data][currency]':'usd',...li,success_url:base+'/#desk',cancel_url:base+'/#desk'});
  run("INSERT INTO orders(product,session,status,ts) VALUES(?,?,'pending',datetime('now'))",[req.body.product,s.id]);res.json({url:s.url})}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/lead',(req,res)=>{const b=req.body;if(!/.+@.+\..+/.test(b.email||''))return res.status(400).json({error:'valid email required'});
  run("INSERT INTO leads(name,email,org,interest,msg,ts) VALUES(?,?,?,?,?,datetime('now'))",[b.name||'',b.email,b.org||'',b.interest||'',String(b.msg||'').slice(0,2000)]);mail(process.env.OPERATOR_EMAIL||'operator','New Drip Trace lead',JSON.stringify(b));res.json({ok:1})});
app.get('/sample-report',(q,r)=>{const b=rateRows("COALESCE(NULLIF(s.brand,''),'Unbranded')"),st=rateRows("s.name||' — '||COALESCE(s.addr,'')").slice(0,10);
  r.send(`<!doctype html><meta name=viewport content="width=device-width"><title>Drip Trace sample report</title><body style="font:15px system-ui;max-width:760px;margin:auto;padding:20px"><h1>Drip Trace — Sample Pump Drip Report (Chattanooga + North GA)</h1><p style="background:#ffe9b0;padding:8px">SAMPLE built from DEMO/synthetic reports on real OpenStreetMap station locations. Not real findings about any station or brand.</p><h2>Drip rate by brand</h2><table>${b.map(x=>`<tr><td>${x.k}</td><td>${x.rate}% of fill-ups</td><td>${x.n} reports</td></tr>`).join('')}</table><h2>Highest drip-rate stations</h2><table>${st.map(x=>`<tr><td>${x.k}</td><td>${x.rate}%</td><td>${x.n}</td></tr>`).join('')}</table><p><a href="/#desk">Request a quote →</a></p>`)});
app.get('/api/v1/export.csv',(q,r)=>{const k=q.query.key||(q.get('authorization')||'').replace('Bearer ','');if(!one('SELECT key FROM apikeys WHERE key=?',[k]))return r.status(401).send('invalid API key');
  const rows=all("SELECT r.ts,s.osm,s.name,s.brand,s.lat,s.lng,r.pump,r.size,r.sev,r.engine='demo' demo FROM reports r JOIN stations s ON s.id=r.station_id WHERE r.verified>=0 ORDER BY r.id DESC LIMIT 100000");
  const esc=v=>/[,"\n]/.test(String(v))?`"${String(v).replace(/"/g,'""')}"`:v;r.type('text/csv').send('utc,osm_id,station,brand,lat,lng,pump,size,severity,demo\n'+rows.map(x=>Object.values(x).map(esc).join(',')).join('\n'))});

// ---- admin ----
app.get('/healthz',(q,r)=>{try{one('SELECT 1 x');r.json({ok:true,vision:process.env.XAI_API_KEY?'xai':'mock',stripe:!!process.env.STRIPE_SECRET_KEY})}catch(e){r.status(500).json({ok:false})}});
app.get('/api/admin/summary',admin,(q,r)=>r.json({money:money(),queue:one("SELECT COUNT(*) n FROM reports WHERE verified=0 AND engine!='demo'").n,rejected:one('SELECT COUNT(*) n FROM reports WHERE verified=-1').n,
  flags:all("SELECT flags,COUNT(*) n FROM reports WHERE flags!='' AND engine!='demo' GROUP BY flags ORDER BY n DESC LIMIT 10"),users:one('SELECT COUNT(*) n FROM users WHERE phone_verified=1').n,
  settings:{sqPrice:SQ_PRICE(),potPct:POTPCT(),prizeOptions:opts(),question:qToday()||null,perReportPay:PAYON(),rate:RATE(),userCap:UCAP(),share:SHARE(),goal:GOAL(),prize:setting('prize')||'$100 gas card',prizeValue:Number(setting('prize_value')||100),paused:setting('payouts_paused')==='1',dailyCap:Number(setting('daily_cap')||200),
    sponsor:{name:setting('sponsor_name')||'',logo:setting('sponsor_logo')||'',link:setting('sponsor_link')||''}},
  queueRows:all("SELECT r.id,u.name,r.ts,s.name station,r.pump,r.size,r.ai_size,r.flags FROM reports r JOIN users u ON u.id=r.user_id JOIN stations s ON s.id=r.station_id WHERE r.verified=0 AND r.engine!='demo' ORDER BY r.id LIMIT 100"),
  leads:all('SELECT name,email,org,interest,msg,ts FROM leads ORDER BY id DESC LIMIT 25'),outbox:all('SELECT to_addr,subject,ts FROM outbox ORDER BY id DESC LIMIT 10'),
  over600:all("SELECT u.name,SUM(p.amount) t FROM payouts p JOIN users u ON u.id=p.user_id WHERE p.ts>=strftime('%Y-01-01','now') GROUP BY u.id HAVING t>=500"),
  winners600:all("SELECT u.name,SUM(d.prize_value) t FROM draws d JOIN users u ON u.id=d.winner WHERE d.week>=strftime('%Y-01-01','now') GROUP BY u.id HAVING t>=600")}));
app.post('/api/admin/review',admin,(q,r)=>{const v=q.body.approve?1:-1;(q.body.ids||[]).map(Number).forEach(i=>run('UPDATE reports SET verified=?,payout=CASE WHEN ?=-1 THEN 0 ELSE payout END WHERE id=?',[v,v,i]));r.json({ok:1})});
app.post('/api/admin/settings',admin,(q,r)=>{const b=q.body,num=(k,v,lo,hi)=>setting(k,Math.max(lo,Math.min(hi,Number(v))));
  if('perReportPay' in b)setting('per_report_pay',b.perReportPay?1:0);if(b.rate!=null)num('report_rate',b.rate,0,1);if(b.userCap!=null)num('user_daily_cap',b.userCap,0,20);
  if(b.potPct!=null)num('pot_pct',b.potPct,0,100);if(Array.isArray(b.prizeOptions)&&b.prizeOptions.length===3)setting('prize_options',JSON.stringify(b.prizeOptions.map(String)));
  if(b.sqPrice!=null)num('sq_price',b.sqPrice,10,1e5);
  if(b.share!=null)num('user_share_pct',b.share,0,95);if(b.goal!=null)num('pot_goal',b.goal,100,1e7);if(b.prize)setting('prize',b.prize);if(b.prizeValue!=null)num('prize_value',b.prizeValue,0,1e6);
  if('paused' in b)setting('payouts_paused',b.paused?1:0);if(b.dailyCap!=null)num('daily_cap',b.dailyCap,0,1e6);
  if(b.sponsor){setting('sponsor_name',b.sponsor.name||'');setting('sponsor_logo',b.sponsor.logo||'');setting('sponsor_link',b.sponsor.link||'')}r.json({ok:1})});
app.post('/api/admin/apikey',admin,(q,r)=>{const k='dt_'+crypto.randomBytes(18).toString('hex');run("INSERT INTO apikeys VALUES(?,?,datetime('now'))",[k,q.body.buyer||'manual']);r.json({key:k})});

(async()=>{const SQL=await initSql();db=fs.existsSync(DBF)?new SQL.Database(fs.readFileSync(DBF)):new SQL.Database();
 db.run(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT UNIQUE,token TEXT,pass_hash TEXT,phone TEXT UNIQUE,phone_verified INT DEFAULT 0,sms_code TEXT,stripe_acct TEXT,bank_fp TEXT,flagged TEXT);
 CREATE TABLE IF NOT EXISTS stations(id INTEGER PRIMARY KEY,osm TEXT UNIQUE,name TEXT,brand TEXT,lat REAL,lng REAL,addr TEXT,city TEXT);
 CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY,user_id INT,station_id INT,pump TEXT,size TEXT,sev INT,ts TEXT,lat REAL,lng REAL,engine TEXT,verified INT,flags TEXT,phash TEXT,payout REAL DEFAULT 0,ai_size TEXT);
 CREATE TABLE IF NOT EXISTS draws(week TEXT PRIMARY KEY,seed TEXT,commit_hash TEXT,winner INT,idx INT,entries_hash TEXT,entries_list TEXT,prize TEXT,prize_value REAL,sponsored INT,ts TEXT);
 CREATE TABLE IF NOT EXISTS amoe(user_id INT,week TEXT);CREATE TABLE IF NOT EXISTS payouts(id INTEGER PRIMARY KEY,user_id INT,amount REAL,ref TEXT,ts TEXT);
 CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,product TEXT,session TEXT,status TEXT,ts TEXT,email TEXT,amount REAL);
 CREATE TABLE IF NOT EXISTS leads(id INTEGER PRIMARY KEY,name TEXT,email TEXT,org TEXT,interest TEXT,msg TEXT,ts TEXT);CREATE TABLE IF NOT EXISTS apikeys(key TEXT PRIMARY KEY,buyer TEXT,ts TEXT);
 CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY,to_addr TEXT,subject TEXT,body TEXT,ts TEXT);CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY,v TEXT);
 CREATE TABLE IF NOT EXISTS questions(id INTEGER PRIMARY KEY,day TEXT,text TEXT,options TEXT,sponsor TEXT,sq_id INT);
 CREATE TABLE IF NOT EXISTS sq(id INTEGER PRIMARY KEY,org TEXT,email TEXT,text TEXT,options TEXT,day TEXT,status TEXT,session TEXT,amount REAL,report_key TEXT,ts TEXT);CREATE TABLE IF NOT EXISTS answers(user_id INT,qid INT,opt INT,day TEXT);
 CREATE TABLE IF NOT EXISTS pvotes(user_id INT,week TEXT,opt INT);CREATE TABLE IF NOT EXISTS dividends(id INTEGER PRIMARY KEY,user_id INT,month TEXT,amount REAL,ts TEXT);`);
 if(!one('SELECT COUNT(*) n FROM questions').n)db.run('INSERT INTO questions(day,text,options) VALUES(?,?,?)',['2026-01-01','How much do you spend on gas a week?',JSON.stringify(['Under $25','$25–50','$50–100','$100+'])]);
 if(!one('SELECT COUNT(*) n FROM stations').n){db.run('BEGIN');for(const s of require('./stations.json'))db.run('INSERT OR IGNORE INTO stations(osm,name,brand,lat,lng,addr,city) VALUES(?,?,?,?,?,?,?)',[s.osm,s.name,s.brand,s.lat,s.lng,s.addr,s.city]);db.run('COMMIT')}
 if(!one('SELECT COUNT(*) n FROM reports').n){ // DEMO seed: synthetic reports on real station locations (engine='demo', never paid, never entered)
  db.run("INSERT OR IGNORE INTO users(name,token) VALUES('demo_seed','x')");const uid=one("SELECT id FROM users WHERE name='demo_seed'").id,S=all('SELECT id,lat,lng FROM stations');
  const SZ=['drop','few','puddle','overflow','nozzle_leak'];db.run('BEGIN');for(let i=0;i<2500;i++){const st=S[Math.floor(Math.random()**1.3*S.length)],base=0.08+((st.id*37)%23)/100;
   const drip=Math.random()<base,size=drip?SZ[Math.min(4,Math.floor(Math.random()**2*5))]:'none';
   db.run(`INSERT INTO reports(user_id,station_id,pump,size,sev,ts,lat,lng,engine,verified,flags,phash) VALUES(?,?,?,?,?,datetime('now','-${Math.floor(Math.random()*56)} day','-${Math.floor(Math.random()*14)} hour'),?,?,'demo',1,'demo','d'||?)`,
    [uid,st.id,String(1+Math.floor(Math.random()*12)),size,SIZES[size].sev,st.lat,st.lng,i])}db.run('COMMIT')}
 save();setInterval(backup,6*3600e3);backup();app.listen(PORT,()=>console.log('Drip Trace on :'+PORT))})();
