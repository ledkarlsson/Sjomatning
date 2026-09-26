import test from 'node:test';
import assert from 'node:assert/strict';
import {manualTrackFile} from '../src/manual-track.mjs';
import {parseTextTrack} from '../src/track-parser.mjs';

test('manual points round trip without inventing depth or measurement time',()=>{
 for(const depth of [null,0,2.35]){
  const file=manualTrackFile({name:'Mitt spår',point:{lat:58.5,lon:15.7,depth}});
  const {points}=parseTextTrack(file.content,file.name);
  assert.equal(points.length,1);assert.equal(points[0].lat,58.5);assert.equal(points[0].lon,15.7);assert.equal(points[0].depth,depth);
  assert.ok(!points[0].time);assert.ok(!points[0].date);
 }
});
test('invalid manual coordinates and depths are rejected',()=>{
 for(const point of [{lat:91,lon:0},{lat:0,lon:181},{lat:NaN,lon:0},{lat:0,lon:0,depth:-1}])assert.throws(()=>manualTrackFile({name:'Spår',point}));
});
