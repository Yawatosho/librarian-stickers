import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {TYPES, COLORS, SHAPES, clampPosition, validSticker, publicSticker, validOwn, validPending, stickerSvg} from '../assets/core.js';
const sample = {row:2,type:1,rating:'fit',x:.42,y:.62,shape:'circle',color:'#ef4444'};
test('all supported payloads pass; untrusted payloads cannot inject markup or private fields', () => {
  for (const shape of Object.keys(SHAPES)) for (const color of Object.keys(COLORS)) {
    assert.equal(validSticker({...sample,shape,color}),true);
    assert.ok(stickerSvg(shape,color).startsWith('<svg'));
  }
  for (const change of [{type:0},{type:17},{type:1.5},{rating:'other'},{x:-.01},{x:NaN},{y:1.01},{shape:'<script>'},{color:'red'},{color:'#ef4444" onload="alert(1)'}]) {
    assert.equal(validSticker({...sample,...change}),false);
  }
  assert.equal(stickerSvg('circle','red'),'');
  assert.deepEqual(publicSticker({...sample,token:'secret',userId:'private'}),sample);
  assert.equal(publicSticker({...sample,row:1}),null);
  assert.equal(validOwn(sample),false);
  assert.equal(validOwn({...sample,token:'signature'}),true);
});
test('clicks at every edge respect sticker radius at phone, tablet and desktop sizes', () => {
  for (const [w,h] of [[56,122],[80,128],[120,140],[160,128]]) for (const [x,y] of [[0,0],[1,0],[0,1],[1,1],[-1,2],[.4,.6]]) {
    const point = clampPosition(x,y,w,h);
    assert.ok(point.x*w >= 13-1e-9 && point.x*w <= w-13+1e-9);
    assert.ok(point.y*h >= 13-1e-9 && point.y*h <= h-13+1e-9);
  }
  assert.deepEqual(clampPosition(0,1,1,1),{x:.5,y:.5});
});
test('pending requests require valid stickers and valid update credentials', () => {
  const requestId = '12345678-1234-1234-1234-123456789abc';
  const p = {requestId,payload:{requestId,operation:'create',sticker:sample}};
  assert.equal(validPending(p),true);
  assert.equal(validPending({...p,payload:{...p.payload,operation:'update'}}),false);
  assert.equal(validPending({...p,payload:{...p.payload,operation:'update',row:2,token:'s'}}),true);
  assert.equal(validPending({...p,requestId:'another-id'}),false);
});
test('16 type IDs match the independent upstream fixture; every card asset exists', () => {
  const source = JSON.parse(readFileSync(new URL('./upstream-types.json',import.meta.url)));
  assert.deepEqual(TYPES,source.types);
  for (const {slug} of TYPES) assert.ok(existsSync(new URL(`../assets/result-ogp/${slug}.webp`,import.meta.url)));
});
