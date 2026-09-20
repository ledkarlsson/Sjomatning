// Optional Safari-engine runner for the same browser regression. Install
// Playwright separately and set MOBILE_PLAYWRIGHT_PATH to its module path.
const {webkit}=require(process.env.MOBILE_PLAYWRIGHT_PATH||'playwright');
let browser;
const app={setPath(){},whenReady:()=>Promise.resolve(),quit:()=>{void close(0);},exit:code=>{void close(code);}};
async function close(code){try{await browser?.close();}finally{process.exit(code);}}
const session={defaultSession:{setPermissionRequestHandler(){},webRequest:{onBeforeRequest(){}}}};
class BrowserWindow {
 constructor(options){
  this.listeners=[];
  this.ready=(async()=>{
   browser=await webkit.launch({headless:true});
   this.context=await browser.newContext({viewport:{width:options.width,height:options.height},isMobile:true,hasTouch:true,deviceScaleFactor:1});
   await this.context.route('https://tile.openstreetmap.org/**',route=>route.abort());
   await this.context.route('https://tiles.openseamap.org/**',route=>route.abort());
   const page=await this.context.newPage();
   page.on('console',message=>{for(const callback of this.listeners)callback({level:message.type(),message:message.text()});});
   page.on('pageerror',error=>{for(const callback of this.listeners)callback({level:'error',message:error.message});});
   return page;
  })();
  this.webContents={
   on:(_event,callback)=>this.listeners.push(callback),
   executeJavaScript:async source=>(await this.ready).evaluate(source),
   capturePage:async()=>{const bytes=await (await this.ready).screenshot({caret:'initial'});return {toPNG:()=>bytes};}
  };
 }
 async loadURL(url){await (await this.ready).goto(url,{waitUntil:'load'});}
 setSize(width,height){this.ready=this.ready.then(async page=>{await page.setViewportSize({width,height});return page;});}
 destroy(){void this.ready.then(page=>page.close()).catch(()=>{});}
}
module.exports={app,BrowserWindow,session};
