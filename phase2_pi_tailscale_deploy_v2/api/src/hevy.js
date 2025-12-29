const BASE = process.env.HEVY_BASE_URL || "https://api.hevyapp.com";
const KEY = process.env.HEVY_API_KEY;

function assertKey(){
  if(!KEY || KEY.includes("PASTE_YOUR")) throw new Error("Missing HEVY_API_KEY in .env");
}

async function hevyFetch(path, params={}){
  assertKey();
  const url = new URL(BASE + path);
  for (const [k,v] of Object.entries(params)) if(v!==undefined && v!==null) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { accept:"application/json", "api-key": KEY } });
  if(!res.ok) throw new Error(`Hevy API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export const listWorkouts = (page=1,pageSize=50)=>hevyFetch("/v1/workouts",{page,pageSize});
export const getWorkout = (id)=>hevyFetch(`/v1/workouts/${id}`);
export const getWorkoutEvents = ({sinceIso,page=1,pageSize=50})=>hevyFetch("/v1/workouts/events",{since:sinceIso,page,pageSize});
