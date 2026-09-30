import { sha256 } from './security';

const captions = ['had to share this', 'this got me', 'every single time', 'too real', 'was not expecting that', 'well that happened'];

export async function createCaption(jobId: string): Promise<string> {
  // Deterministic, brief, no paid AI service and no untrusted source-caption copying.
  const seed = parseInt((await sha256(jobId)).slice(0, 8), 16);
  return `${captions[seed % captions.length]}\n\n#fyp #memes #funny`;
}
