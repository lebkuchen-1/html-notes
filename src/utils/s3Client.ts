export type CloudProviderPreset = 'r2' | 'b2' | 'custom';

export interface CloudSyncConfig {
  provider: CloudProviderPreset;
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
}

const CLOUD_CONFIG_STORAGE_KEY = 'solid-notes:v1:cloudConfig';
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export const DEFAULT_CLOUD_CONFIG: CloudSyncConfig = {
  provider: 'r2',
  endpoint: '',
  bucket: '',
  region: 'auto',
  accessKeyId: '',
  secretAccessKey: '',
  prefix: 'notizblock',
};

export function normalizeCloudConfig(raw: Partial<CloudSyncConfig> | null | undefined): CloudSyncConfig {
  const provider: CloudProviderPreset =
    raw?.provider === 'r2' || raw?.provider === 'b2' || raw?.provider === 'custom'
      ? raw.provider
      : 'r2';

  let endpoint = typeof raw?.endpoint === 'string' ? raw.endpoint.trim() : '';
  // Strip trailing slashes
  endpoint = endpoint.replace(/\/+$/, '');
  if (endpoint && !/^https?:\/\//i.test(endpoint)) {
    endpoint = `https://${endpoint}`;
  }

  const bucket = typeof raw?.bucket === 'string' ? raw.bucket.trim().replace(/^\/+|\/+$/g, '') : '';
  let region = typeof raw?.region === 'string' ? raw.region.trim() : '';
  if (!region) {
    region = inferRegionFromEndpoint(endpoint, provider);
  }

  const prefix =
    typeof raw?.prefix === 'string'
      ? raw.prefix.trim().replace(/^\/+|\/+$/g, '')
      : 'notizblock';

  return {
    provider,
    endpoint,
    bucket,
    region,
    accessKeyId: typeof raw?.accessKeyId === 'string' ? raw.accessKeyId.trim() : '',
    secretAccessKey: typeof raw?.secretAccessKey === 'string' ? raw.secretAccessKey.trim() : '',
    prefix,
  };
}

export function inferRegionFromEndpoint(endpoint: string, provider: CloudProviderPreset): string {
  if (provider === 'r2' || endpoint.includes('.r2.cloudflarestorage.com')) {
    return 'auto';
  }
  // Backblaze B2: https://s3.eu-central-003.backblazeb2.com
  const b2Match = endpoint.match(/s3\.([a-z0-9-]+)\.backblazeb2\.com/i);
  if (b2Match?.[1]) {
    return b2Match[1];
  }
  // AWS S3: https://s3.eu-central-1.amazonaws.com
  const awsMatch = endpoint.match(/s3\.([a-z0-9-]+)\.amazonaws\.com/i);
  if (awsMatch?.[1]) {
    return awsMatch[1];
  }
  return provider === 'b2' ? 'eu-central-003' : 'us-east-1';
}

export function isCloudConfigComplete(config: CloudSyncConfig | null | undefined): boolean {
  if (!config) return false;
  return Boolean(
    config.endpoint.trim() &&
      config.bucket.trim() &&
      config.region.trim() &&
      config.accessKeyId.trim() &&
      config.secretAccessKey.trim()
  );
}

export function getCloudBucketFingerprint(config: CloudSyncConfig): string {
  const norm = normalizeCloudConfig(config);
  return `${norm.endpoint.toLowerCase()}|${norm.bucket}|${norm.prefix}`;
}

export function loadCloudConfig(): CloudSyncConfig | null {
  try {
    const raw = localStorage.getItem(CLOUD_CONFIG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CloudSyncConfig>;
    return normalizeCloudConfig(parsed);
  } catch {
    return null;
  }
}

export function saveCloudConfig(config: CloudSyncConfig): void {
  try {
    localStorage.setItem(CLOUD_CONFIG_STORAGE_KEY, JSON.stringify(normalizeCloudConfig(config)));
  } catch {
    // ignore
  }
}

export function clearCloudConfig(): void {
  try {
    localStorage.removeItem(CLOUD_CONFIG_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Build ready-to-paste CORS snippet for the current app origin + GitHub Pages */
export function buildR2CorsPolicyJson(): string {
  const origins = new Set<string>([
    'https://lebkuchen-1.github.io',
    'http://localhost:3000',
  ]);
  if (typeof window !== 'undefined' && window.location?.origin?.startsWith('http')) {
    origins.add(window.location.origin);
  }
  return JSON.stringify(
    [
      {
        AllowedOrigins: [...origins],
        AllowedMethods: ['GET', 'PUT', 'HEAD', 'DELETE'],
        AllowedHeaders: [
          'authorization',
          'content-type',
          'x-amz-date',
          'x-amz-content-sha256',
        ],
        ExposeHeaders: ['ETag'],
        MaxAgeSeconds: 3600,
      },
    ],
    null,
    2
  );
}

export function buildB2CorsRulesJson(): string {
  const origins = new Set<string>([
    'https://lebkuchen-1.github.io',
    'http://localhost:3000',
  ]);
  if (typeof window !== 'undefined' && window.location?.origin?.startsWith('http')) {
    origins.add(window.location.origin);
  }
  return JSON.stringify(
    [
      {
        corsRuleName: 'notizblockS3Access',
        allowedOrigins: [...origins],
        allowedOperations: ['s3_get', 's3_put', 's3_head', 's3_delete'],
        allowedHeaders: [
          'authorization',
          'content-type',
          'x-amz-date',
          'x-amz-content-sha256',
        ],
        exposeHeaders: ['etag'],
        maxAgeSeconds: 3600,
      },
    ],
    null,
    2
  );
}

// ==================== AWS SigV4 (Web Crypto) ====================

const textEncoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? textEncoder.encode(data) : data;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return toHex(digest);
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  let keyBuffer: ArrayBuffer;
  if (key instanceof Uint8Array) {
    const copy = new Uint8Array(key.byteLength);
    copy.set(key);
    keyBuffer = copy.buffer;
  } else {
    keyBuffer = key;
  }
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, textEncoder.encode(message));
}

async function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service = 's3'
): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(textEncoder.encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

/** RFC 3986 URI encoding required by AWS SigV4 */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function encodeS3Path(bucket: string, objectKey?: string): string {
  const segments = [bucket];
  if (objectKey) {
    const cleaned = objectKey.replace(/^\/+/, '');
    if (cleaned) {
      segments.push(...cleaned.split('/'));
    }
  }
  return `/${segments.map(encodeRfc3986).join('/')}`;
}

function formatAmzDates(date = new Date()): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    amzDate: iso, // YYYYMMDDTHHMMSSZ
    dateStamp: iso.slice(0, 8), // YYYYMMDD
  };
}

export function resolvePrefixedKey(config: CloudSyncConfig, relativeKey: string): string {
  const cleanPrefix = config.prefix.trim().replace(/^\/+|\/+$/g, '');
  const cleanRel = relativeKey.replace(/^\/+/, '');
  return cleanPrefix ? `${cleanPrefix}/${cleanRel}` : cleanRel;
}

export class S3RequestError extends Error {
  status: number;
  code: 'cors_or_network' | 'auth' | 'not_found' | 'server' | 'aborted' | 'config';

  constructor(
    message: string,
    status: number,
    code: S3RequestError['code']
  ) {
    super(message);
    this.name = 'S3RequestError';
    this.status = status;
    this.code = code;
  }
}

async function signedS3Fetch(
  rawConfig: CloudSyncConfig,
  options: {
    method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
    objectKey?: string;
    query?: Record<string, string>;
    body?: Uint8Array;
    contentType?: string;
    signal?: AbortSignal;
  }
): Promise<Response> {
  const config = normalizeCloudConfig(rawConfig);
  if (!isCloudConfigComplete(config)) {
    throw new S3RequestError('Cloud-Verbindung ist unvollständig konfiguriert.', 0, 'config');
  }

  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(config.endpoint);
  } catch {
    throw new S3RequestError('Ungültige Endpoint-URL.', 0, 'config');
  }

  const basePath = parsedEndpoint.pathname.replace(/\/+$/, '');
  const canonicalPath = `${basePath}${encodeS3Path(config.bucket, options.objectKey)}`;

  // Canonical query string sorted by key then value
  const queryEntries = Object.entries(options.query ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  const canonicalQuery = queryEntries.map(([k, v]) => `${k}=${v}`).join('&');

  const payloadHash = options.body ? await sha256Hex(options.body) : EMPTY_SHA256;
  const { amzDate, dateStamp } = formatAmzDates();
  const host = parsedEndpoint.host;

  // Keep signed headers minimal & deterministic (avoids Safari content-type quirks)
  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    options.method,
    canonicalPath,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = await deriveSigningKey(
    config.secretAccessKey,
    dateStamp,
    config.region,
    's3'
  );
  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers: Record<string, string> = {
    Authorization: authorization,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
  };
  if (options.contentType) {
    headers['Content-Type'] = options.contentType;
  }

  const requestUrl = `${parsedEndpoint.origin}${canonicalPath}${canonicalQuery ? `?${canonicalQuery}` : ''}`;

  let bodyInit: BodyInit | undefined;
  if (options.body) {
    const copy = new Uint8Array(options.body.byteLength);
    copy.set(options.body);
    bodyInit = copy.buffer;
  }

  const REQUEST_TIMEOUT_MS = 60_000;
  const timeoutCtrl = new AbortController();
  let timedOut = false;
  const onOuterAbort = () => timeoutCtrl.abort();
  if (options.signal) {
    if (options.signal.aborted) {
      throw new S3RequestError('Vorgang abgebrochen.', 0, 'aborted');
    }
    options.signal.addEventListener('abort', onOuterAbort, { once: true });
  }
  const timeoutId = setTimeout(() => {
    timedOut = true;
    timeoutCtrl.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    return await fetch(requestUrl, {
      method: options.method,
      headers,
      body: bodyInit,
      mode: 'cors',
      cache: 'no-store',
      signal: timeoutCtrl.signal,
    });
  } catch (err) {
    if (options.signal?.aborted) {
      throw new S3RequestError('Vorgang abgebrochen.', 0, 'aborted');
    }
    if (timedOut) {
      throw new S3RequestError(
        'Zeitüberschreitung bei der Übertragung (60 s). Bitte Netzwerkverbindung prüfen.',
        0,
        'cors_or_network'
      );
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new S3RequestError('Vorgang abgebrochen.', 0, 'aborted');
    }
    throw new S3RequestError(
      'Verbindung fehlgeschlagen (Netzwerk oder CORS-Policy im Bucket fehlt).',
      0,
      'cors_or_network'
    );
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', onOuterAbort);
  }
}

async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (signal?.aborted) throw err;
    if (err instanceof S3RequestError && err.code === 'server') {
      await new Promise((r) => setTimeout(r, 450));
      return fn();
    }
    throw err;
  }
}

function classifyHttpError(status: number, detail: string): S3RequestError {
  if (status === 401 || status === 403) {
    return new S3RequestError(
      `Zugriff verweigert (HTTP ${status}). Bitte Access Key, Secret Key, Region und Bucket-Rechte prüfen.${detail ? ` (${detail})` : ''}`,
      status,
      'auth'
    );
  }
  if (status === 404) {
    return new S3RequestError(
      `Bucket oder Objekt nicht gefunden (HTTP 404).${detail ? ` (${detail})` : ''}`,
      status,
      'not_found'
    );
  }
  return new S3RequestError(
    `Serverfehler (HTTP ${status}).${detail ? ` (${detail})` : ''}`,
    status,
    'server'
  );
}

async function extractS3ErrorCode(res: Response): Promise<string> {
  try {
    const text = await res.text();
    const codeMatch = text.match(/<Code>([^<]+)<\/Code>/);
    const msgMatch = text.match(/<Message>([^<]+)<\/Message>/);
    if (codeMatch?.[1] && msgMatch?.[1]) return `${codeMatch[1]}: ${msgMatch[1]}`;
    if (codeMatch?.[1]) return codeMatch[1];
    return text.slice(0, 140).trim();
  } catch {
    return '';
  }
}

export async function s3GetObject(
  config: CloudSyncConfig,
  relativeKey: string,
  signal?: AbortSignal
): Promise<Uint8Array | null> {
  return withRetry(async () => {
    const res = await signedS3Fetch(config, {
      method: 'GET',
      objectKey: resolvePrefixedKey(config, relativeKey),
      signal,
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw classifyHttpError(res.status, await extractS3ErrorCode(res));
    }
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }, signal);
}

export async function s3HeadObject(
  config: CloudSyncConfig,
  relativeKey: string,
  signal?: AbortSignal
): Promise<boolean> {
  const res = await signedS3Fetch(config, {
    method: 'HEAD',
    objectKey: resolvePrefixedKey(config, relativeKey),
    signal,
  });
  if (res.status === 404) return false;
  if (!res.ok) {
    throw classifyHttpError(res.status, await extractS3ErrorCode(res));
  }
  return true;
}

export async function s3PutObject(
  config: CloudSyncConfig,
  relativeKey: string,
  bytes: Uint8Array,
  contentType = 'application/octet-stream',
  signal?: AbortSignal
): Promise<void> {
  return withRetry(async () => {
    const res = await signedS3Fetch(config, {
      method: 'PUT',
      objectKey: resolvePrefixedKey(config, relativeKey),
      body: bytes,
      contentType,
      signal,
    });
    if (!res.ok) {
      throw classifyHttpError(res.status, await extractS3ErrorCode(res));
    }
  }, signal);
}

export async function s3DeleteObject(
  config: CloudSyncConfig,
  relativeKey: string,
  signal?: AbortSignal
): Promise<void> {
  const res = await signedS3Fetch(config, {
    method: 'DELETE',
    objectKey: resolvePrefixedKey(config, relativeKey),
    signal,
  });
  if (res.status === 404 || res.status === 204 || res.ok) return;
  throw classifyHttpError(res.status, await extractS3ErrorCode(res));
}

function parseListObjectsXml(xmlText: string): {
  keys: string[];
  isTruncated: boolean;
  nextToken: string | null;
} {
  const keys: string[] = [];
  let isTruncated = false;
  let nextToken: string | null = null;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');
    const keyEls = doc.getElementsByTagName('Key');
    for (let i = 0; i < keyEls.length; i++) {
      const val = keyEls[i].textContent;
      if (val) keys.push(val);
    }
    const truncEl = doc.getElementsByTagName('IsTruncated')[0];
    isTruncated = truncEl?.textContent?.trim().toLowerCase() === 'true';
    const tokenEl = doc.getElementsByTagName('NextContinuationToken')[0];
    nextToken = tokenEl?.textContent?.trim() || null;
    return { keys, isTruncated, nextToken };
  } catch {
    // Fallback regex parsing
    const keyMatches = xmlText.matchAll(/<Key>([^<]+)<\/Key>/g);
    for (const m of keyMatches) {
      if (m[1]) keys.push(m[1]);
    }
    isTruncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xmlText);
    const tokenMatch = xmlText.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    nextToken = tokenMatch?.[1] ?? null;
    return { keys, isTruncated, nextToken };
  }
}

/** Lists relative keys under `subPrefix` (e.g. 'blobs/') using S3 ListObjectsV2. */
export async function s3ListRelativeKeys(
  config: CloudSyncConfig,
  subPrefix: string,
  signal?: AbortSignal
): Promise<string[]> {
  const rootPrefix = resolvePrefixedKey(config, '');
  const stripPrefix = rootPrefix ? `${rootPrefix}/` : '';
  const fullPrefix = resolvePrefixedKey(config, subPrefix);

  const collected: string[] = [];
  let continuationToken: string | null = null;

  for (let page = 0; page < 50; page++) {
    const query: Record<string, string> = {
      'list-type': '2',
      'max-keys': '1000',
    };
    if (fullPrefix) query.prefix = fullPrefix;
    if (continuationToken) query['continuation-token'] = continuationToken;

    const res = await signedS3Fetch(config, {
      method: 'GET',
      query,
      signal,
    });
    if (!res.ok) {
      throw classifyHttpError(res.status, await extractS3ErrorCode(res));
    }
    const xml = await res.text();
    const parsed = parseListObjectsXml(xml);
    for (const fullKey of parsed.keys) {
      const rel =
        stripPrefix && fullKey.startsWith(stripPrefix)
          ? fullKey.slice(stripPrefix.length)
          : fullKey;
      collected.push(rel);
    }
    if (!parsed.isTruncated || !parsed.nextToken) break;
    continuationToken = parsed.nextToken;
  }

  return collected;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  hasManifest: boolean;
}

export async function testCloudConnection(
  config: CloudSyncConfig,
  signal?: AbortSignal
): Promise<ConnectionTestResult> {
  try {
    // 1) List max 1 key to verify bucket + credentials + CORS
    const res = await signedS3Fetch(config, {
      method: 'GET',
      query: {
        'list-type': '2',
        'max-keys': '1',
        ...(config.prefix.trim() ? { prefix: `${config.prefix.trim().replace(/^\/+|\/+$/g, '')}/` } : {}),
      },
      signal,
    });
    if (!res.ok) {
      const err = classifyHttpError(res.status, await extractS3ErrorCode(res));
      return { ok: false, message: err.message, hasManifest: false };
    }

    // 2) Check if manifest.json exists
    const hasManifest = await s3HeadObject(config, 'manifest.json', signal);
    return {
      ok: true,
      hasManifest,
      message: hasManifest
        ? 'Verbindung erfolgreich — bestehendes Online-Backup gefunden.'
        : 'Verbindung erfolgreich — Bucket bereit für dein erstes Backup.',
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unbekannter Fehler beim Verbindungstest.';
    return { ok: false, message, hasManifest: false };
  }
}
