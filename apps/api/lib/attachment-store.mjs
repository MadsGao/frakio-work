import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';

export const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
export const MAX_MESSAGE_ATTACHMENT_BYTES = 100 * 1024 * 1024;
export const ORPHAN_ATTACHMENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.heic']);
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.xml', '.yaml', '.yml', '.toml', '.sql',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.css', '.scss', '.less', '.html', '.htm', '.py', '.rb', '.php',
  '.java', '.kt', '.kts', '.go', '.rs', '.swift', '.c', '.h', '.cpp', '.cc', '.hpp', '.cs', '.sh', '.zsh', '.bash',
  '.fish', '.ps1', '.vue', '.svelte', '.astro', '.ini', '.cfg', '.conf', '.env', '.log', '.tex', '.svg',
]);
const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.odt', '.rtf', '.xls', '.xlsx', '.ppt', '.pptx', '.odp', '.ico']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.flac', '.opus']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.mpeg', '.mpg']);
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.tar', '.gz', '.tgz', '.bz2', '.7z']);
const SAFE_INLINE_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function attachmentError(message, status = 400, code = 'ATTACHMENT_INVALID') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export function sanitizeAttachmentName(value) {
  const base = path.basename(String(value || '').normalize('NFC')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const cleaned = base.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').slice(0, 160);
  if (!cleaned || cleaned === '.' || cleaned === '..') throw attachmentError('附件名称无效。');
  return cleaned;
}

function sniffMime(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.subarray(0, 2).toString('ascii') === 'BM') return 'image/bmp';
  if (buffer.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || buffer.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))) return 'image/tiff';
  if (buffer.subarray(0, 4).toString('ascii') === '%PDF') return 'application/pdf';
  if (buffer.subarray(0, 2).equals(Buffer.from([0x50, 0x4b]))) return 'application/zip';
  return '';
}

export function classifyAttachment(name, declaredMimeType = '', data = Buffer.alloc(0)) {
  const extension = path.extname(name).toLowerCase();
  const declared = String(declaredMimeType || '').split(';', 1)[0].trim().toLowerCase();
  const sniffed = sniffMime(data);
  if (IMAGE_EXTENSIONS.has(extension)) return { kind: 'image', mimeType: sniffed.startsWith('image/') ? sniffed : declared || 'application/octet-stream' };
  if (TEXT_EXTENSIONS.has(extension) || declared.startsWith('text/')) return { kind: 'text', mimeType: declared || 'text/plain' };
  if (DOCUMENT_EXTENSIONS.has(extension)) return { kind: 'document', mimeType: sniffed || declared || 'application/octet-stream' };
  if (AUDIO_EXTENSIONS.has(extension) || declared.startsWith('audio/')) return { kind: 'audio', mimeType: declared || 'application/octet-stream' };
  if (VIDEO_EXTENSIONS.has(extension) || declared.startsWith('video/')) return { kind: 'video', mimeType: declared || 'application/octet-stream' };
  if (ARCHIVE_EXTENSIONS.has(extension)) return { kind: 'archive', mimeType: sniffed || declared || 'application/octet-stream' };
  throw attachmentError(`暂不支持“${extension || '未知'}”类型的附件。`, 415, 'ATTACHMENT_TYPE_UNSUPPORTED');
}

function assertAttachmentId(value) {
  const id = String(value || '');
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw attachmentError('附件 ID 无效。', 400, 'ATTACHMENT_ID_INVALID');
  return id;
}

function publicAttachment(metadata) {
  return {
    id: metadata.id,
    name: metadata.name,
    mimeType: metadata.mimeType,
    size: metadata.size,
    kind: metadata.kind,
    createdAt: metadata.createdAt,
    contentUrl: `/api/attachments/${metadata.id}/content`,
  };
}

export function createAttachmentStore(rootPath) {
  const root = path.resolve(rootPath);

  async function metadataFor(idValue) {
    const id = assertAttachmentId(idValue);
    try {
      const parsed = JSON.parse(await readFile(path.join(root, id, 'metadata.json'), 'utf8'));
      if (parsed.id !== id || !parsed.storedName) throw new Error('metadata mismatch');
      return parsed;
    } catch (error) {
      if (error?.code === 'ENOENT') throw attachmentError('附件不存在或已被清理。', 404, 'ATTACHMENT_NOT_FOUND');
      if (error?.status) throw error;
      throw attachmentError('附件元数据损坏。', 500, 'ATTACHMENT_METADATA_INVALID');
    }
  }

  async function save({ name, mimeType, data }) {
    if (!Buffer.isBuffer(data) || data.length === 0) throw attachmentError('附件内容为空。');
    if (data.length > MAX_ATTACHMENT_BYTES) throw attachmentError('单个附件不能超过 32 MiB。', 413, 'ATTACHMENT_TOO_LARGE');
    const safeName = sanitizeAttachmentName(name);
    const classified = classifyAttachment(safeName, mimeType, data);
    const id = randomUUID();
    const dir = path.join(root, id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const storedName = `content${path.extname(safeName).toLowerCase()}`;
    const createdAt = new Date().toISOString();
    const metadata = { id, name: safeName, storedName, mimeType: classified.mimeType, size: data.length, kind: classified.kind, createdAt, claimedAt: null, threadId: null, messageId: null };
    try {
      await writeFile(path.join(dir, storedName), data, { mode: 0o600 });
      await writeFile(path.join(dir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
    } catch (error) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    return publicAttachment(metadata);
  }

  async function resolveMany(idsValue) {
    const ids = Array.from(new Set((Array.isArray(idsValue) ? idsValue : []).map(String)));
    if (ids.length > MAX_ATTACHMENTS_PER_MESSAGE) throw attachmentError('每条消息最多添加 10 个附件。', 400, 'ATTACHMENT_COUNT_EXCEEDED');
    const metadata = await Promise.all(ids.map(metadataFor));
    const total = metadata.reduce((sum, item) => sum + Number(item.size || 0), 0);
    if (total > MAX_MESSAGE_ATTACHMENT_BYTES) throw attachmentError('单条消息的附件总量不能超过 100 MiB。', 413, 'ATTACHMENT_TOTAL_TOO_LARGE');
    return metadata;
  }

  async function claim(metadataItems, threadId, messageId) {
    const claimedAt = new Date().toISOString();
    await Promise.all(metadataItems.map(async (metadata) => {
      if (metadata.threadId && metadata.threadId !== threadId) throw attachmentError('附件已经绑定到其他对话。', 409, 'ATTACHMENT_ALREADY_CLAIMED');
      const next = { ...metadata, claimedAt, threadId, messageId };
      await writeFile(path.join(root, metadata.id, 'metadata.json'), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      Object.assign(metadata, next);
    }));
  }

  async function removeDraft(id) {
    const metadata = await metadataFor(id);
    if (metadata.threadId) throw attachmentError('已发送的附件不能单独删除。', 409, 'ATTACHMENT_ALREADY_CLAIMED');
    await rm(path.join(root, metadata.id), { recursive: true, force: true });
  }

  async function content(id) {
    const metadata = await metadataFor(id);
    const attachmentDir = path.join(root, metadata.id);
    const filePath = path.resolve(attachmentDir, String(metadata.storedName || ''));
    const relativePath = path.relative(attachmentDir, filePath);
    if (!relativePath || relativePath.startsWith(`..${path.sep}`) || relativePath === '..' || path.isAbsolute(relativePath)) {
      throw attachmentError('附件元数据中的存储路径无效。', 500, 'ATTACHMENT_METADATA_INVALID');
    }
    await stat(filePath);
    return { metadata, filePath, inline: metadata.kind === 'image' && SAFE_INLINE_IMAGE_MIMES.has(metadata.mimeType) };
  }

  async function removeForThreads(threadIdsValue) {
    const threadIds = new Set((threadIdsValue || []).map(String));
    if (!threadIds.size) return 0;
    await mkdir(root, { recursive: true, mode: 0o700 });
    const entries = await readdir(root, { withFileTypes: true });
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const metadata = await metadataFor(entry.name);
        if (metadata.threadId && threadIds.has(metadata.threadId)) {
          await rm(path.join(root, entry.name), { recursive: true, force: true });
          removed += 1;
        }
      } catch {}
    }
    return removed;
  }

  async function cleanupOrphans(nowMs = Date.now()) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const entries = await readdir(root, { withFileTypes: true });
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const metadata = await metadataFor(entry.name);
        const createdAt = Date.parse(metadata.createdAt || '');
        if (!metadata.threadId && (!Number.isFinite(createdAt) || nowMs - createdAt > ORPHAN_ATTACHMENT_MAX_AGE_MS)) {
          await rm(path.join(root, entry.name), { recursive: true, force: true });
          removed += 1;
        }
      } catch {}
    }
    return removed;
  }

  return { save, metadataFor, resolveMany, claim, removeDraft, content, removeForThreads, cleanupOrphans, publicAttachment };
}
