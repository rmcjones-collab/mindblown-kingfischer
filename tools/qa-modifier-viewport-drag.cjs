// Real-page regression: viewport changes during an off-centre modifier drag.
// Usage: node tools/qa-modifier-viewport-drag.cjs <brain-url>
// Requires an installed Modifiers module. Resize plus keyboard activation of
// Zoom out exercises the renderer's real translation/scale mapping.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const url=process.argv[2];
try { if(!/^https?:$/.test(new URL(url).protocol))throw Error(); }
catch { console.error('Usage: node tools/qa-modifier-viewport-drag.cjs <http(s)-brain-url>');process.exit(2); }
const snap=p=>p.evaluate(()=>window.MINDBLOWN_MODIFIERS.snapshot());
// Do not include private neuron IDs or scenario payloads in assertion output.
const same=(a,b,message)=>assert(JSON.stringify(a)===JSON.stringify(b),message);
const different=(a,b,message)=>assert(JSON.stringify(a)!==JSON.stringify(b),message);
async function settled(p,origin){
  await p.evaluate(()=>{window.__viewportDragStable=null;});
  await p.waitForFunction(([x,y])=>{
    const point=window.MINDBLOWN_RENDERER.toScreen(x,y),old=window.__viewportDragStable;
    const n=old&&Math.hypot(point[0]-old.p[0],point[1]-old.p[1])<0.005?old.n+1:0;
    window.__viewportDragStable={p:point,n};
    return n>=12;
  },origin,{timeout:15000,polling:'raf'});
}
async function open(p){await p.locator('.modifier-node').first().focus();await p.keyboard.press('Enter');await p.locator('#modifier-panel').waitFor({state:'visible'});}
(async()=>{
  const browser=await chromium.launch({channel:'chromium'}),fails=[],errors=[];
  try{
    for(const mode of ['old-press-point','reprojected-origin','subpixel-origin','capture-loss']){
      const context=await browser.newContext({viewport:{width:1440,height:900}});
      const p=await context.newPage();p.on('pageerror',e=>errors.push(mode+': '+e.message));
      try{
        await p.goto(url,{waitUntil:'networkidle',timeout:60000});
        await p.waitForFunction(()=>window.MINDBLOWN_MODIFIERS&&window.MINDBLOWN_RENDERER,null,{timeout:120000});
        await p.evaluate(()=>{
          const launch=[...document.querySelectorAll('button')].find(x=>/modifier/i.test(x.getAttribute('aria-label')||x.title||''));
          if(!launch)throw Error('modifier launcher unavailable');launch.click();
        });
        await p.click('#modifier-beside');
        await p.click('#modifier-close');
        let state=await snap(p),origin=[state.modifiers[0].x,state.modifiers[0].y];
        await settled(p,origin);
        await open(p);
        const slider=p.locator('.modifier-card input[type=range]').first();
        await slider.focus();await p.keyboard.press('ArrowRight');
        const redoState=await snap(p);different(redoState,state,'seed a real slider edit');
        await p.click('#modifier-undo');same(await snap(p),state,'undo seed slider');
        await p.click('#modifier-close');
        await settled(p,origin);
        const h=p.locator('.modifier-node').first(),box=await h.boundingBox();assert(box);
        const press=[box.x+box.width/2+9,box.y+box.height/2-6];
        const centre=await p.evaluate(o=>window.MINDBLOWN_RENDERER.toScreen(...o),origin);
        const grab=[press[0]-centre[0],press[1]-centre[1]];
        await h.evaluate(el=>{
          el.addEventListener('pointerdown',e=>{window.__viewportDragPointer=e.pointerId;},{once:true});
          el.addEventListener('pointerup',e=>{window.__viewportDragRelease=[e.clientX,e.clientY];},{once:true});
        });
        await p.mouse.move(...press);await p.mouse.down();
        await p.mouse.move(press[0]+60,press[1]+30,{steps:5});
        different(await snap(p),state,'the handle actually moved');
        await p.setViewportSize({width:1920,height:1080});
        // Neural preserves its camera on resize. Activate the real zoom control
        // with the keyboard while the mouse remains down and captured.
        await p.locator('#z-out').focus();await p.keyboard.press('Enter');
        await settled(p,origin);
        const current=await p.evaluate(o=>window.MINDBLOWN_RENDERER.toScreen(...o),origin);
        assert(Math.hypot(current[0]-centre[0],current[1]-centre[1])>5,'resize/zoom must actually change the origin projection');
        if(mode==='capture-loss'){
          await h.evaluate(el=>el.releasePointerCapture(window.__viewportDragPointer));
          await p.mouse.move(press[0]+62,press[1]+32);await p.mouse.up();
        }else{
          const release=mode==='old-press-point'?press:[current[0]+grab[0]+(mode==='subpixel-origin'?0.25:0),current[1]+grab[1]];
          await p.mouse.move(...release,{steps:5});await p.mouse.up();
          if(mode==='subpixel-origin'){
            const delivered=await p.evaluate(()=>window.__viewportDragRelease);
            const displacement=Math.hypot(delivered[0]-current[0]-grab[0],delivered[1]-current[1]-grab[1]);
            assert(displacement>0.1&&displacement<0.5,'native pointerup delivered a nonzero subpixel return');
          }
          if(mode==='old-press-point'){
            const actual=await snap(p);different(actual,state,'release at old press point is now a genuine world move');
            const screen=await p.evaluate(()=>{const m=window.MINDBLOWN_MODIFIERS.snapshot().modifiers[0];return window.MINDBLOWN_RENDERER.toScreen(m.x,m.y);});
            assert(Math.hypot(screen[0]+grab[0]-release[0],screen[1]+grab[1]-release[1])<0.5,'handle stays at release position with its grab offset');
            await open(p);assert(await p.locator('#modifier-redo').isDisabled(),'genuine move invalidates old redo');
            await p.click('#modifier-undo');same(await snap(p),state,'one undo reverses the move');
            await p.click('#modifier-undo');assert.equal((await snap(p)).modifiers.length,0,'second undo reverses placement, with no extra entry');
            await p.click('#modifier-redo');same(await snap(p),state,'redo placement');
            await p.click('#modifier-redo');same(await snap(p),actual,'redo move');
            assert(await p.locator('#modifier-redo').isDisabled(),'redo exhausted after actual move');
          }
        }
        if(mode!=='old-press-point'){
          same(await snap(p),state,'return/cancel restores exact original world state');
          await open(p);assert(await p.locator('#modifier-redo').isEnabled(),'original redo preserved');
          await p.click('#modifier-redo');same(await snap(p),redoState,'original redo payload preserved');
          assert(await p.locator('#modifier-redo').isDisabled(),'no extra redo entry');
          await p.click('#modifier-undo');same(await snap(p),state,'undo original slider');
          await p.click('#modifier-undo');assert.equal((await snap(p)).modifiers.length,0,'return/cancel adds no undo entry');
        }
        console.log('PASS '+mode);
      }catch(e){fails.push(mode+': '+e.message);console.error('FAIL '+mode+': '+e.message);}
      finally{await context.close();}
    }
  }finally{await browser.close();}
  console.log(JSON.stringify({fails,errors}));
  process.exitCode=fails.length||errors.length?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
