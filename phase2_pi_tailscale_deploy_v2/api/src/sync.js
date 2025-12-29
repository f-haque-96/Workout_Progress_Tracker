import { listWorkouts, getWorkoutEvents, getWorkout } from "./hevy.js";
import { getMeta, setMeta } from "./db.js";

const META_KEY = "hevy_last_sync_iso";

export async function initialBackfill(db){
  let page=1; const pageSize=50;
  const stmt=db.prepare("INSERT INTO hevy_workouts(id,updated_at,payload_json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,payload_json=excluded.payload_json");
  while(true){
    const data=await listWorkouts(page,pageSize);
    const workouts=data?.workouts || data || [];
    if(!workouts.length) break;
    const tx=db.transaction(rows=>{ for(const w of rows){ const id=w.id||w.workout_id||w.workoutId; if(!id) continue; stmt.run(id, w.updated_at||w.updatedAt||null, JSON.stringify(w)); }});
    tx(workouts);
    page++;
  }
  setMeta(db, META_KEY, new Date().toISOString());
}

export async function incrementalSync(db){
  const since=getMeta(db, META_KEY, "1970-01-01T00:00:00Z");
  let page=1; const pageSize=50; let newestSeen=since;
  const insertEvent=db.prepare("INSERT INTO hevy_events(event_type,workout_id,occurred_at,raw_json) VALUES(?,?,?,?)");
  const upsert=db.prepare("INSERT INTO hevy_workouts(id,updated_at,payload_json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,payload_json=excluded.payload_json");
  const del=db.prepare("DELETE FROM hevy_workouts WHERE id=?");

  while(true){
    const data=await getWorkoutEvents({sinceIso:since,page,pageSize});
    const events=data?.events || data?.workout_events || data || [];
    if(!events.length) break;
    for(const ev of events){
      const type=(ev.type||ev.event_type||ev.eventType||"unknown");
      const workoutId=ev.workout_id||ev.workoutId||ev.id||null;
      const occurredAt=ev.occurred_at||ev.occurredAt||ev.updated_at||ev.updatedAt||new Date().toISOString();
      insertEvent.run(type, workoutId, occurredAt, JSON.stringify(ev));
      if(occurredAt>newestSeen) newestSeen=occurredAt;
      if(type.toLowerCase().includes('delete')){ if(workoutId) del.run(workoutId); }
      else if(workoutId){
        const full=await getWorkout(workoutId);
        const w=full?.workout || full;
        upsert.run(w?.id||workoutId, w?.updated_at||w?.updatedAt||occurredAt, JSON.stringify(w));
      }
    }
    page++;
  }
  setMeta(db, META_KEY, newestSeen);
  return { since, newestSeen };
}
