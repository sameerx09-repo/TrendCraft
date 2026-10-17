const {chromium}=require("C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:"C:/Users/Admin/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe"});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:1000}});
  await page.goto("http://localhost:3001/viral-trends");
  await page.waitForSelector(".curated-preview video");
  await page.waitForFunction(()=>[...document.querySelectorAll(".curated-preview video")].every(v=>v.readyState>=2||v.error),{},{timeout:20000});
  console.log(JSON.stringify(await page.locator(".curated-preview video").evaluateAll(videos=>videos.map(v=>({ready:v.readyState,width:v.videoWidth,height:v.videoHeight,error:v.error?.message})))));
  await page.screenshot({path:"output/playwright/workspace-trends-loaded.png"});
 }finally{await browser.close()}
})().catch(e=>{console.error(e.message);process.exit(1)});
