import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cron from 'node-cron';

import { openDb, getMeta } from './db.js';
import { initialBackfill, incrementalSync } from './sync.js';
import { verifyHealthToken } from './health.js';

dotenv.config();

const app=express();
app.use(cors());
app.use(express.json({limit:'25mb'}));

const PORT=Number(process.env.PORT||8787);
const db=openDb();

app.get('/api/status',(req,res)=>{
  res.json({ ok:true, hevy_last_sync_iso: getMeta(db,'hevy_last_sync_iso',null) });
});

app.get('/api/workouts',(req,res)=>{
  const rows=db.prepare('SELECT payload_json FROM hevy_workouts ORDER BY updated_at DESC LIMIT 500').all();
  res.json({ workouts: rows.map(r=>JSON.parse(r.payload_json)) });
});

app.post('/api/sync/hevy/backfill', async (req,res)=>{
  try{ await initialBackfill(db); res.json({ok:true}); }
  catch(e){ res.status(500).json({ok:false,error:String(e?.message||e)}); }
});

app.post('/api/sync/hevy', async (req,res)=>{
  try{ const result=await incrementalSync(db); res.json({ok:true,...result}); }
  catch(e){ res.status(500).json({ok:false,error:String(e?.message||e)}); }
});

app.post('/api/health/ingest',(req,res)=>{
  if(!verifyHealthToken(req)) return res.status(401).json({ok:false,error:'bad_token'});
  const source=req.query.source || req.header('x-health-source') || 'unknown';
  db.prepare('INSERT INTO health_ingest(received_at, source, raw_json) VALUES(?,?,?)')
    .run(new Date().toISOString(), String(source), JSON.stringify(req.body));
  res.json({ok:true});
});

app.get('/api/health/ingest',(req,res)=>{
  const items=db.prepare('SELECT id,received_at,source FROM health_ingest ORDER BY id DESC LIMIT 20').all();
  res.json({items});
});

const every=Number(process.env.HEVY_SYNC_EVERY_MINUTES||0);
if(every>0){
  const expr=`*/${every} * * * *`;
  console.log('Hevy auto-sync enabled:', expr);
  cron.schedule(expr, async ()=>{ try{ await incrementalSync(db); console.log('Hevy sync OK', new Date().toISOString()); }
    catch(e){ console.error('Hevy sync failed', e); } });
}

app.listen(PORT,'0.0.0.0',()=>console.log(`hdt-api listening on :${PORT}`));
