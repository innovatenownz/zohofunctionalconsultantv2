import dns from 'dns';
import { promisify } from 'util';
import http from 'http';
import https from 'https';
import net from 'net';

const resolve4 = promisify(dns.resolve4);
const resolve6 = promisify(dns.resolve6);

function isPrivateIp(ip: string): boolean {
  if (ip === '0.0.0.0' || ip === '::') return true;
  
  const ipv4Parts = ip.split('.').map(Number);
  if (ipv4Parts.length === 4 && !ipv4Parts.some(isNaN)) {
    const [p0, p1, p2, p3] = ipv4Parts;
    if (p0 === 10) return true;
    if (p0 === 127) return true;
    if (p0 === 169 && p1 === 254) return true;
    if (p0 === 172 && p1 >= 16 && p1 <= 31) return true;
    if (p0 === 192 && p1 === 168) return true;
    return false;
  }

  const normalizedIp = ip.toLowerCase();
  if (normalizedIp === '::1' || normalizedIp === '::') return true;
  if (normalizedIp.startsWith('fe80:')) return true;
  if (normalizedIp.startsWith('fc00:') || normalizedIp.startsWith('fd00:')) return true;

  return false;
}

export async function isSafeUrl(urlStr: string): Promise<boolean> {
  try {
    const url = new URL(urlStr);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }
    const hostname = url.hostname;
    
    // Check basic hostnames first
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      return false;
    }
    
    // Resolve all IPs (comprehensive check)
    const ips: string[] = [];
    if (net.isIP(hostname)) {
      ips.push(hostname);
    } else {
      try {
        const ipv4s = await resolve4(hostname).catch(() => []);
        ips.push(...ipv4s);
      } catch {}

      try {
        const ipv6s = await resolve6(hostname).catch(() => []);
        ips.push(...ipv6s);
      } catch {}
    }

    if (ips.length === 0) {
      return false;
    }

    for (const ip of ips) {
      if (isPrivateIp(ip)) {
        return false;
      }
    }
    
    return true;
  } catch {
    return false;
  }
}

export interface SafeFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
  json(): Promise<any>;
}

export async function safeFetch(urlStr: string, init?: any): Promise<SafeFetchResponse> {
  const url = new URL(urlStr);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Unsupported protocol');
  }

  // 1. Resolve DNS
  const ips: string[] = [];
  if (net.isIP(url.hostname)) {
    ips.push(url.hostname);
  } else {
    try {
      const ipv4s = await resolve4(url.hostname).catch(() => []);
      ips.push(...ipv4s);
    } catch {}

    try {
      const ipv6s = await resolve6(url.hostname).catch(() => []);
      ips.push(...ipv6s);
    } catch {}
  }

  if (ips.length === 0) {
    throw new Error(`DNS resolution failed for ${url.hostname}`);
  }

  // 2. Validate all resolved IPs
  for (const ip of ips) {
    if (isPrivateIp(ip)) {
      throw new Error(`SSRF blocked: Hostname resolved to private IP ${ip}`);
    }
  }

  const selectedIp = ips[0];

  // 3. Make HTTP/HTTPS request pinned to the selected IP
  return new Promise((resolve, reject) => {
    const headers = { ...init?.headers };
    // Set Host header
    headers['Host'] = url.hostname;

    const reqOptions: any = {
      method: init?.method || 'GET',
      headers,
      path: url.pathname + url.search,
      // If HTTPS, we must configure servername (SNI) so TLS handshake succeeds
      ...(url.protocol === 'https:' ? {
        hostname: selectedIp,
        port: url.port || 443,
        servername: url.hostname,
      } : {
        hostname: selectedIp,
        port: url.port || 80,
      })
    };

    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf8');
        const status = res.statusCode || 200;
        resolve({
          ok: status >= 200 && status < 300,
          status,
          statusText: res.statusMessage || '',
          async text() { return bodyText; },
          async json() { return JSON.parse(bodyText); }
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (init?.body) {
      req.write(init.body);
    }
    req.end();
  });
}
