const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const ts=require("typescript");
const source=fs.readFileSync(require("node:path").join(__dirname,"../lib/mission-control/types.ts"),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const exportsObject={};vm.runInNewContext(compiled,{exports:exportsObject});
const {engineOf,statusOf}=exportsObject;
function row(hookType=null,renderedFileUrl=null,status="pending"){
  return {script:{hookType},post:{status,renderedFileUrl},trendItem:{platform:"local_upload"}};
}
test("product and persona ads stay distinct even with the same upload source",()=>{
  assert.equal(engineOf(row("product_ad")),"product");
  assert.equal(engineOf(row("ai_ugc")),"ugc");
  assert.equal(engineOf({...row(),trendItem:null}),"ugc");
  assert.equal(engineOf(row("campaign_remix")),"remix");
});
test("unrendered historical posts are drafts until a render is actually queued",()=>{
  assert.equal(statusOf(row()),"Storyboard draft");
  assert.equal(statusOf(row(),{state:"queued"}),"In progress");
  assert.equal(statusOf(row(),{state:"failed"}),"Render failed");
});
test("revision requests are visible for rendered pending creatives",()=>{
  assert.equal(statusOf(row(null,"/video.mp4"),{state:"changes"}),"Changes requested");
  assert.equal(statusOf(row(null,"/video.mp4")),"Needs review");
  assert.equal(statusOf(row(null,"/video.mp4","kept")),"Kept");
});
