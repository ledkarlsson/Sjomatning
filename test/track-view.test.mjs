import test from 'node:test'
import assert from 'node:assert/strict'
import {buildPointIndex,countPoints,viewPoints} from '../src/track-view.mjs'
test('overview bounds work and retain shallowest soundings without mutating raw points',()=>{
 const points=Array.from({length:100000},(_,i)=>({lat:58+(i%1000)*.000001,lon:15+Math.floor(i/1000)*.000001,depth:i===45678?.1:5}))
 const index=buildPointIndex(points),bounds={west:14,east:16,south:57,north:59}
 const overview=viewPoints(index,bounds,.01,.01)
 assert.equal(overview.length,1);assert.equal(overview[0].point.depth,.1);assert.equal(points.length,100000)
 assert.equal(countPoints(index,bounds),100000)
 const close={west:15,east:15.000004,south:58,north:58.000004}
 assert.equal(countPoints(index,close),points.filter(p=>p.lon<=close.east&&p.lat<=close.north).length)
 assert.ok(viewPoints(index,close,.0000001,.0000001).length>1)
 assert.equal(viewPoints(index,{west:1,east:2,south:1,north:2},.01,.01).length,0)
})
