import * as path from 'path';
import type { GitService } from './gitService';
import { EMPTY_TREE } from './diffTargets';

/** Formats the diff shows as pictures. SVG is not in the list: Git diffs it as text, and that diff stays. */
const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
};

/** Larger pictures are not sent to the view (base64 in a message): it shows their size only. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const imageMime = (file: string): string | undefined => MIME[path.extname(file).toLowerCase()];

/** One side of an image diff. `url` is missing when the picture is over the limit. */
export interface ImageSide { bytes: number; url?: string }

/** Both sides of an image diff; a missing side means the file did not exist there. */
export interface ImagePair { old?: ImageSide; new?: ImageSide }

/** The picture in `data` as the view takes it; undefined when there is nothing. */
export function imageSide(data: Buffer | undefined, mime: string): ImageSide | undefined {
  if (!data) return undefined;
  if (data.length > MAX_IMAGE_BYTES) return { bytes: data.length };
  return { bytes: data.length, url: `data:${mime};base64,${data.toString('base64')}` };
}

/** Where one side of an image lives: at a revision, in the index, or in the working tree. */
export type ImageSource =
  | { kind: 'rev'; rev: string; file: string }
  | { kind: 'index'; file: string }
  | { kind: 'workingTree'; file: string }
  | undefined;

/**
 * Reads the two sides of an image diff, or returns undefined when the file is no picture Bonsai shows (or neither
 * side can be read, so the plain "binary file" note stays). The size comes first: a picture over the limit is never read.
 */
export async function readImages(svc: GitService, left: ImageSource, right: ImageSource): Promise<ImagePair | undefined> {
  const side = async (src: ImageSource): Promise<ImageSide | undefined> => {
    const mime = src && imageMime(src.file);
    if (!src || !mime) return undefined;
    const rev = src.kind === 'rev' ? src.rev : '';
    const size = src.kind === 'workingTree' ? await svc.workingFileSize(src.file) : await svc.blobSize(rev, src.file);
    if (size === undefined) return undefined;
    if (size > MAX_IMAGE_BYTES) return { bytes: size };
    return imageSide(src.kind === 'workingTree' ? await svc.workingFile(src.file) : await svc.showBlob(rev, src.file), mime);
  };
  const [old, now] = await Promise.all([side(left), side(right)]);
  return old || now ? { ...(old && { old }), ...(now && { new: now }) } : undefined;
}

/** The sides of a file of a commit (or between two refs) as `readImages` wants them; the empty tree has no files. */
export const refSource = (rev: string, file: string): ImageSource => (rev === EMPTY_TREE ? undefined : { kind: 'rev', rev, file });
