import { env } from 'cloudflare:workers';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiVideoDownloader, MetaGraphDownloader, PublicPageDownloader, downloadVideo } from '../src/downloaders';
import type { Env, ReelSource } from '../src/types';

const source: ReelSource = {messageId:'mid',senderId:'111',recipientId:'222',timestamp:Date.now(),kind:'shared-post',mediaId:'123'};
const bindings = {...env,META_ACCESS_TOKEN:'fake-meta'} as Env;
const video = () => new Response(new Uint8Array(12), {headers:{'Content-Type':'video/mp4','Content-Length':'12'}});
afterEach(()=>vi.restoreAllMocks());

it('uses official Graph metadata for ambiguous current post shares and requires a Reel', async () => {
  const fetcher = vi.spyOn(globalThis,'fetch').mockImplementation(async input => String(input).includes('graph.instagram.com')
    ? Response.json({media_type:'VIDEO',media_product_type:'REELS',media_url:'https://scontent.cdninstagram.com/clip.mp4'}) : video());
  const result = await new MetaGraphDownloader().download(source,bindings);
  expect(result.provider).toBe('meta-graph');
  expect(fetcher).toHaveBeenCalledTimes(2);
  fetcher.mockResolvedValue(Response.json({media_type:'IMAGE',media_product_type:'FEED',media_url:'https://scontent.cdninstagram.com/image.jpg'}));
  await expect(new MetaGraphDownloader().download(source,bindings)).rejects.toThrow('meta_media_not_reel');
});

it('resolves published video metadata only on the canonical Reel page', async () => {
  vi.spyOn(globalThis,'fetch').mockImplementation(async input => String(input).includes('instagram.com/reel/')
    ? new Response('<meta property="og:video:secure_url" content="https://scontent.cdninstagram.com/clip.mp4?a=1&amp;b=2">') : video());
  const result = await new PublicPageDownloader().download({...source,kind:'reel',reelUrl:'https://www.instagram.com/reel/ABCdef123/'});
  expect(result.provider).toBe('instagram-public-page');
});

it('optional API uses its explicit adapter contract and requires Reel evidence for ambiguous shares', async () => {
  const fetcher = vi.spyOn(globalThis,'fetch').mockImplementation(async (input,init) => {
    if(String(input).includes('api.downloader.example')) {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fake-optional-key');
      expect(JSON.parse(String(init?.body)).mediaId).toBe('123');
      return Response.json({videoUrl:'https://scontent.cdninstagram.com/clip.mp4',isReel:true});
    }
    return video();
  });
  const optional = {...bindings,DOWNLOADER_API_URL:'https://api.downloader.example/resolve',DOWNLOADER_API_KEY:'fake-optional-key'};
  expect((await new ApiVideoDownloader().download(source,optional)).provider).toBe('optional-downloader-api');
  fetcher.mockResolvedValue(Response.json({videoUrl:'https://scontent.cdninstagram.com/clip.mp4',isReel:false}));
  await expect(new ApiVideoDownloader().download(source,optional)).rejects.toThrow('not_reel');
});

it('rejects thumbnail MIME and backs off transient download network failures', async () => {
  const fetcher = vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('thumbnail',{headers:{'Content-Type':'image/jpeg'}}));
  const reel = {...source,kind:'reel' as const,mediaId:undefined,attachmentUrl:'https://lookaside.fbsbx.com/a'};
  await expect(downloadVideo(reel,bindings,'job')).rejects.toMatchObject({code:'no_downloader_could_resolve_reel',retryable:false});
  fetcher.mockRejectedValue(new Error('network unavailable'));
  await expect(downloadVideo(reel,bindings,'job')).rejects.toMatchObject({code:'no_downloader_could_resolve_reel',retryable:true});
});
