import { AppError, errorCode, log, type Env, type ReelSource } from './types';
import { limitedBytes, META_MEDIA_HOSTS, reelUrl, safeFetch, secureUrl } from './security';
import { metaRequest } from './meta';

export interface DownloadedVideo {
  response: Response;
  provider: string;
}
export interface VideoDownloader {
  readonly name: string;
  supports(source: ReelSource, env: Env): boolean;
  download(source: ReelSource, env: Env): Promise<DownloadedVideo>;
}

async function videoAt(url: string, hosts: string[], provider: string): Promise<DownloadedVideo> {
  const response = await safeFetch(url, hosts);
  if (!response.ok) { await response.body?.cancel(); throw new AppError(`download_http_${response.status}`, response.status >= 500 || response.status === 429); }
  if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'video/mp4') {
    await response.body?.cancel(); throw new AppError('download_not_mp4');
  }
  return { response, provider };
}

export class MetaAttachmentDownloader implements VideoDownloader {
  readonly name = 'meta-attachment';
  supports(source: ReelSource): boolean { return !!source.attachmentUrl && source.kind === 'reel'; }
  async download(source: ReelSource): Promise<DownloadedVideo> {
    return videoAt(source.attachmentUrl!, META_MEDIA_HOSTS, this.name);
  }
}

export class MetaGraphDownloader implements VideoDownloader {
  readonly name = 'meta-graph';
  supports(source: ReelSource, env: Env): boolean { return !!source.mediaId && !!env.META_ACCESS_TOKEN; }
  async download(source: ReelSource, env: Env): Promise<DownloadedVideo> {
    const media = await metaRequest<{ media_type?: string; media_product_type?: string; media_url?: string; permalink?: string }>(env,
      `${encodeURIComponent(source.mediaId!)}?fields=media_type,media_product_type,media_url,permalink`);
    if (media.media_type !== 'VIDEO' || (media.media_product_type !== 'REELS' && !reelUrl(media.permalink)) || !media.media_url) throw new AppError('meta_media_not_reel');
    return videoAt(media.media_url, META_MEDIA_HOSTS, this.name);
  }
}

function decodeHtml(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x([a-f0-9]+);/gi, (_, n) => String.fromCharCode(parseInt(n,16))).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n,10)));
}

export class PublicPageDownloader implements VideoDownloader {
  readonly name = 'instagram-public-page';
  supports(source: ReelSource, env: Env): boolean { return !!source.reelUrl && env.ALLOW_PUBLIC_PAGE_DOWNLOADER === 'true'; }
  async download(source: ReelSource): Promise<DownloadedVideo> {
    const response = await safeFetch(source.reelUrl!, ['instagram.com'], { headers: { Accept: 'text/html' } });
    if (!response.ok) { await response.body?.cancel(); throw new AppError('public_page_unavailable', response.status === 429 || response.status >= 500); }
    const html = new TextDecoder().decode(await limitedBytes(response.body, 1_500_000));
    const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
    for (const tag of metaTags) {
      if (!/property\s*=\s*["']og:video(?::url|:secure_url)?["']/i.test(tag)) continue;
      const value = /content\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
      if (value) return videoAt(decodeHtml(value), META_MEDIA_HOSTS, this.name);
    }
    // Narrowly accept video_url from the Reel's embedded JSON, never eval scripts.
    const encoded = /"video_url"\s*:\s*("(?:\\.|[^"\\])+")/.exec(html)?.[1];
    if (encoded) {
      let url: string;
      try { url = JSON.parse(encoded); } catch { throw new AppError('public_page_invalid_media'); }
      return videoAt(url, META_MEDIA_HOSTS, this.name);
    }
    throw new AppError('public_page_no_video');
  }
}

export class ApiVideoDownloader implements VideoDownloader {
  readonly name = 'optional-downloader-api';
  supports(source: ReelSource, env: Env): boolean { return !!env.DOWNLOADER_API_URL && !!(source.reelUrl || source.mediaId); }
  async download(source: ReelSource, env: Env): Promise<DownloadedVideo> {
    // This is our documented adapter contract, not an invented vendor endpoint.
    const endpoint = secureUrl(env.DOWNLOADER_API_URL!, [new URL(env.DOWNLOADER_API_URL!).hostname]);
    if (/^\d|:/.test(endpoint.hostname) || !endpoint.hostname.includes('.') || endpoint.hostname.endsWith('.local')) throw new AppError('downloader_invalid_host');
    let response: Response;
    try { response = await fetch(endpoint.toString(), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { 'Content-Type': 'application/json', ...(env.DOWNLOADER_API_KEY ? { Authorization: `Bearer ${env.DOWNLOADER_API_KEY}` } : {}) },
      body: JSON.stringify({ url: source.reelUrl, mediaId: source.mediaId, attachmentUrl: source.attachmentUrl }),
    }); } catch { throw new AppError('downloader_api_network_error', true); }
    if (!response.ok) { await response.body?.cancel(); throw new AppError('downloader_api_error', response.status === 429 || response.status >= 500); }
    let data: { videoUrl?: string; contentType?: string; isReel?: boolean };
    try { data = JSON.parse(new TextDecoder().decode(await limitedBytes(response.body, 64_000))); } catch { throw new AppError('downloader_api_invalid_response'); }
    if (!data.videoUrl || (source.kind !== 'reel' && data.isReel !== true)) throw new AppError('downloader_api_not_reel');
    const hosts = [...META_MEDIA_HOSTS, ...(env.DOWNLOADER_MEDIA_HOSTS?.split(',').map(h => h.trim()).filter(h => /^[a-z0-9.-]+$/.test(h)) ?? [])];
    return videoAt(data.videoUrl, hosts, this.name);
  }
}

export const providers: VideoDownloader[] = [new MetaAttachmentDownloader(), new MetaGraphDownloader(), new PublicPageDownloader(), new ApiVideoDownloader()];

export async function downloadVideo(source: ReelSource, env: Env, jobId: string): Promise<DownloadedVideo> {
  let retryable = false;
  for (const provider of providers) {
    if (!provider.supports(source, env)) continue;
    try { return await provider.download(source, env); }
    catch (error) { retryable ||= error instanceof AppError && error.retryable; log('downloader_failed', { job: jobId, provider: provider.name, code: errorCode(error) }); }
  }
  throw new AppError('no_downloader_could_resolve_reel', retryable);
}
