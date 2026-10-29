import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { enqueue, processJob, recoverVideoUpload, saveSetting } from '../src/jobs';
import worker from '../src/index';
import type { Env } from '../src/types';

const bindings: Env = { ...env, BUFFER_API_KEY: 'fake-buffer' };
const reel = 'https://www.instagram.com/reel/Recovery123/';
const mp4 = new Uint8Array([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109,109,112,52,50]);
const media = () => new Response(mp4, { headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(mp4.length) } });
async function pending(sender = '111', timestamp = Date.now()) {
  const id = await enqueue(bindings, { messageId: crypto.randomUUID(), senderId: sender, recipientId: '222', timestamp, kind: 'reel', reelUrl: reel, title: 'Original @creator #same' });
  await env.DB.prepare("UPDATE jobs SET state='attention',error_code='instagram_media_restricted' WHERE id=?").bind(id).run();
  return id;
}
beforeEach(async () => {
  await env.DB.batch(['deliveries','jobs','settings'].map(t=>env.DB.prepare(`DELETE FROM ${t}`)));
  const list = await env.MEDIA.list(); if (list.objects.length) await env.MEDIA.delete(list.objects.map(o=>o.key));
  await saveSetting(bindings, 'recipient_ids', ['222']);
  await saveSetting(bindings, 'channels', ['instagram','tiktok'].map((service,i)=>({id:service,name:'memes',service,serviceId:String(222+i),organizationId:'org',isDisconnected:false,isLocked:false})));
});
afterEach(()=>vi.restoreAllMocks());

it('recovers only the existing job, publishes each channel once and removes private media', async () => {
  const id = await pending();
  await recoverVideoUpload(bindings,id,reel,media());
  expect(await env.DB.prepare('SELECT state FROM jobs WHERE id=?').bind(id).first('state')).toBe('ready');
  expect(await env.DB.prepare('SELECT caption FROM jobs WHERE id=?').bind(id).first('caption')).toBe('Original #same\n\n#fyp #memes');
  await expect(recoverVideoUpload(bindings,id,reel,media())).rejects.toThrow('upload_recovery_not_safe');
  let creates=0;
  vi.spyOn(globalThis,'fetch').mockImplementation(async (_input,init)=>{
    const b=JSON.parse(String(init?.body));
    return b.query.includes('mutation') ? Response.json({data:{createPost:{__typename:'PostActionSuccess',post:{id:'post-'+ ++creates,status:'sending',schedulingType:'automatic'}}}}) : Response.json({data:{post:{id:b.variables.input.id,status:'sent',schedulingType:'automatic'}}});
  });
  await processJob(bindings,id);
  await env.DB.prepare('UPDATE jobs SET next_run_at=0 WHERE id=?').bind(id).run();
  await processJob(bindings,id);
  await processJob(bindings,id);
  expect(creates).toBe(2);
  expect(await env.DB.prepare('SELECT state FROM jobs WHERE id=?').bind(id).first('state')).toBe('completed');
  expect((await env.MEDIA.list()).objects).toHaveLength(0);
});

it('rejects strangers, stale DMs and mismatched Reel identities', async () => {
  for (const id of [await pending('999'),await pending('111',Date.now()-49*3600000)]) await expect(recoverVideoUpload(bindings,id,reel,media())).rejects.toThrow('upload_recovery_not_safe');
  await expect(recoverVideoUpload(bindings,await pending(),'https://www.instagram.com/reel/Other123/',media())).rejects.toThrow('upload_recovery_not_safe');
  expect((await env.MEDIA.list()).objects).toHaveLength(0);
});

it('refuses recovery after any Buffer reservation exists', async () => {
  const id=await pending();
  await env.DB.prepare("INSERT INTO deliveries(job_id,service,channel_id,state,updated_at) VALUES (?,'instagram','instagram','unknown',?)").bind(id,Date.now()).run();
  await expect(recoverVideoUpload(bindings,id,reel,media())).rejects.toThrow('upload_recovery_not_safe');
});

it('does not retain invalid media or create deliveries', async () => {
  const id=await pending();
  await expect(recoverVideoUpload(bindings,id,reel,new Response('abcdefghijkl',{headers:{'Content-Type':'video/mp4','Content-Length':'12'}}))).rejects.toThrow('video_signature_invalid');
  expect((await env.MEDIA.list()).objects).toHaveLength(0);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM deliveries').first('n')).toBe(0);
  expect(await env.DB.prepare('SELECT object_key FROM jobs WHERE id=?').bind(id).first('object_key')).toBeNull();
});

it('authenticates uploads before touching jobs or reading the body', async () => {
  const ctx=createExecutionContext();
  const res=await worker.fetch(new Request('https://worker.example/admin/jobs/recover-upload',{method:'POST',body:mp4}),bindings,ctx);
  await waitOnExecutionContext(ctx);
  expect(res.status).toBe(401);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM jobs').first('n')).toBe(0);
});
