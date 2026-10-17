const {loadEnvConfig}=require("@next/env"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),postgres=require("postgres");
loadEnvConfig(process.cwd());
(async()=>{
 const sql=postgres(process.env.DATABASE_URL,{prepare:false});
 try {
  await sql.unsafe(fs.readFileSync(path.join(__dirname,"../drizzle/brand-auth.sql"),"utf8"));
  const email=process.argv[2];if(!email||!email.includes("@"))throw Error("Supply the workspace owner's email.");
  const [brand]=await sql`SELECT id,name FROM brand_profiles WHERE domain='glo-vibe.com' ORDER BY created_at LIMIT 1`;if(!brand)throw Error("Existing GloVibe workspace was not found.");
  const [owner]=await sql`SELECT id FROM auth_users WHERE brand_profile_id=${brand.id}`;
  const directory=path.resolve("storage/auth");fs.mkdirSync(directory,{recursive:true});
  if(!owner){
   const setupFile=path.join(directory,"owner-setup.json");let previous;try{previous=JSON.parse(fs.readFileSync(setupFile,"utf8"));}catch{}
   const token=previous?.token||crypto.randomBytes(32).toString("hex");
   const hash=crypto.createHash("sha256").update(token).digest("hex");
   await sql`INSERT INTO auth_bootstrap(id,token_hash,email,brand_profile_id,expires_at) VALUES('owner',${hash},${email.toLowerCase()},${brand.id},now()+interval '3 days') ON CONFLICT(id) DO UPDATE SET token_hash=EXCLUDED.token_hash,email=EXCLUDED.email,expires_at=EXCLUDED.expires_at WHERE auth_bootstrap.claimed_at IS NULL`;
   fs.writeFileSync(setupFile,JSON.stringify({token,email,brandId:brand.id,url:"http://localhost:3001/login#setup="+token},null,2),{mode:0o600});
  }
  const envPath=path.resolve(".env.local"),env=fs.readFileSync(envPath,"utf8");
  if(!/^AUTH_WORKER_TOKEN=/m.test(env))fs.appendFileSync(envPath,"\nAUTH_WORKER_TOKEN="+crypto.randomBytes(32).toString("hex")+"\n");
  console.log("Auth tables ready; existing content preserved. Owner setup saved locally for "+email+". No password generated.");
 }finally{await sql.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1});