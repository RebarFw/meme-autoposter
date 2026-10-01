import { META_MEDIA_HOSTS, reelUrl } from '../security';
import { AppError, type Env, type ReelSource } from '../types';
import { downloadSignal, type VideoDownloader } from '../video-downloader';
import { candidates, enabled, record, requestedReel, siteJson, siteText } from './shared';

export class FastDlDownloader implements VideoDownloader {
  readonly name = 'fastdl';
  supports(source: ReelSource, env: Env) { return enabled(this.name, source, env); }
  async download(source: ReelSource, env: Env, parent?: AbortSignal) {
    const signal = downloadSignal(parent, 15_000);
    const url = requestedReel(source);
    // Website's observed anonymous fallback contract when its signing module
    // is unavailable. CAPTCHA/signing-required responses fail closed.
    const text = await siteText('https://api-wh.fastdl.app/api/convert', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: 'https://fastdl.app', Referer: 'https://fastdl.app/en5IW' },
      body: JSON.stringify({ target_url: url }),
    }, signal);
    const result = siteJson(text);
    const items = Array.isArray(result) ? result : [result];
    if (items.length !== 1) throw new AppError('fastdl_not_single_video');
    const item = record(items[0]);
    if (item.success === false) throw new AppError('fastdl_unavailable');
    if ((typeof item.code === 'string' && item.code !== new URL(url).pathname.split('/')[2]) || (typeof item.source_url === 'string' && reelUrl(item.source_url) !== url)) throw new AppError('fastdl_wrong_reel');
    if (!Array.isArray(item.video_versions)) throw new AppError('fastdl_no_video');
    const version = record(item.video_versions[0]);
    const urls = [version.url, version.url_downloadable].filter((v): v is string => typeof v === 'string');
    return candidates(urls, [...META_MEDIA_HOSTS, 'media.fastdl.app'], this.name, env, signal);
  }
}
