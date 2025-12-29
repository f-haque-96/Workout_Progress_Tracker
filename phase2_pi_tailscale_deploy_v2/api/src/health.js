export function verifyHealthToken(req){
  const expected=process.env.HEALTH_INGEST_TOKEN;
  if(!expected) return true;
  const got=req.header('x-health-token') || req.query.token;
  return got && got===expected;
}
