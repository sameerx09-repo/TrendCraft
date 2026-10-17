const {chromium}=require('C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('fs');const path=require('path');
const base='http://localhost:3001';const output=path.resolve('output/playwright');
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/Admin/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'});
try{
const context=await browser.newContext({viewport:{width:1280,height:1000}});
const page=await context.newPage();const errors=[];const requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')requests.push(r.url())});
await page.goto(base);await page.waitForSelector('.mc-engine-grid');
const getData=async()=>(await context.request.get(base+'/api/mission-control')).json();
let data=await getData();
const product=data.products.find(p=>p.title.includes('Magnesium'))||data.products[0];
if(!product)throw Error('Product catalog missing');
let campaign=data.campaigns.find(c=>c.brief.name==='Night care launch'&&c.brief.productId===product.id);
if(!campaign){
await page.getByRole('button',{name:'New campaign',exact:true}).click();
const dialog=page.getByRole('dialog');await dialog.getByLabel('Campaign name',{exact:true}).fill('Night care launch');
await dialog.getByLabel('Campaign product',{exact:true}).selectOption(product.id);
await dialog.getByLabel('Campaign goal',{exact:true}).fill('Introduce an evening skincare ritual');
await dialog.getByLabel('Audience',{exact:true}).fill('Skincare shoppers in India');
await dialog.getByLabel('Core message',{exact:true}).fill('A quiet evening ritual with Magnesium Night Renewal Cream.');
await dialog.getByRole('button',{name:'Create campaign',exact:true}).click();
await dialog.waitFor({state:'hidden'});
data=await getData();campaign=data.campaigns.find(c=>c.brief.name==='Night care launch');
}
await page.getByLabel('Select campaign',{exact:true}).selectOption(campaign.id);
await page.reload();await page.waitForSelector('.mc-engine-grid');
if(await page.getByLabel('Select campaign',{exact:true}).inputValue()!==campaign.id)throw Error('Campaign selection not restored');
let creative=campaign.creatives.find(c=>c.title==='Evening ritual');
if(!creative){
await page.getByRole('tab',{name:'Product UGC',exact:true}).click();
await page.getByLabel('Creative title',{exact:true}).fill('Evening ritual');
await page.getByLabel('Caption',{exact:true}).fill('An evening ritual with GloVibe.');
await page.getByRole('button',{name:'Save storyboard',exact:true}).click();
await page.getByRole('status').filter({hasText:'Storyboard saved'}).waitFor();
data=await getData();campaign=data.campaigns.find(c=>c.id===campaign.id);creative=campaign.creatives.find(c=>c.title==='Evening ritual');
}
if(!creative)throw Error('Product storyboard was not saved');
const originalBrief=campaign.brief;
try{
let response=await context.request.post(base+'/api/mission-control',{data:{action:'brief',campaignId:campaign.id,brief:{...originalBrief,creditCap:0}}});if(!response.ok())throw Error('Budget update failed');
response=await context.request.post(base+'/api/mission-control',{data:{action:'render',campaignId:campaign.id,postId:creative.postId}});
const result=await response.json();if(response.status()!==400||!result.error.includes('credit cap'))throw Error('Budget guard did not block rendering');
}finally{await context.request.post(base+'/api/mission-control',{data:{action:'brief',campaignId:campaign.id,brief:originalBrief}})}
const invalid=await context.request.post(base+'/api/mission-control',{data:{action:'draft',campaignId:campaign.id,engine:'ugc',personaId:'not-a-persona',beats:['Hook','Reveal','CTA']}});
if(invalid.status()!==400)throw Error('Invalid persona was accepted');
await page.reload();await page.waitForSelector('.mc-engine-grid');
const tabs=['Overview','Brief','Remix','AI UGC','Product UGC','Review','Activity','Exports'];const checks=[];
for(const width of [1280,768,390,320]){
await page.setViewportSize({width,height:1000});
for(const tab of tabs){
await page.getByRole('tab',{name:tab,exact:true}).click();
if(tab==='Review')await page.getByLabel('Creative to review',{exact:true}).selectOption(creative.postId);
await page.waitForTimeout(120);
const overflow=await page.locator('.mc-workspace').evaluate(el=>{const b=el.getBoundingClientRect();return [...el.querySelectorAll('*')].filter(n=>n.getClientRects().length&&n.getBoundingClientRect().right>b.right+2).slice(0,5).map(n=>n.tagName+'.'+n.className)});
checks.push({width,tab,overflow});
if(width===1280)await page.screenshot({path:path.join(output,'mission-'+tab.toLowerCase().replace(/ /g,'-')+'.png'),fullPage:tab!=='Overview'});
if(width===390&&['Overview','Product UGC','Review'].includes(tab))await page.screenshot({path:path.join(output,'mission-mobile-'+tab.toLowerCase().replace(/ /g,'-')+'.png'),fullPage:true});
}}
await page.setViewportSize({width:1280,height:1000});
await page.getByRole('tab',{name:'Review',exact:true}).click();await page.getByLabel('Creative to review',{exact:true}).selectOption(creative.postId);
await page.getByRole('button',{name:'Review generation',exact:true}).click();
const dialog=page.getByRole('dialog');await dialog.getByText('Estimated Runway credits',{exact:true}).waitFor();await dialog.getByRole('button',{name:'Keep editing',exact:true}).click();
await page.getByRole('button',{name:'Agent',exact:true}).click();await page.locator('.pa-agent').waitFor();
await page.getByRole('button',{name:'Workspace',exact:true}).click();
await page.goto(base+'/creatives');await page.waitForSelector('.page-wide');
const failures=checks.filter(c=>c.overflow.length);
fs.writeFileSync(path.join(output,'mission-control-checks.json'),JSON.stringify({checks,errors,campaignId:campaign.id,postId:creative.postId,requests},null,2));
console.log(JSON.stringify({screens:checks.length,failures,errors,campaign:campaign.brief.name,draft:creative.title,budgetGuard:'passed',invalidPersona:'rejected',paidGeneration:'not run'},null,2));
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});

