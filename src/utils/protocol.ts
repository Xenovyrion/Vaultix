/** Detect the protocol of an entry URL and return open metadata */

export interface ProtocolInfo {
  type: "web" | "rdp" | "ssh" | "vnc" | "ftp" | "sftp" | "telnet" | "other";
  label: string;
  color: string;
  openable: boolean;
  /** Returns the final URL to pass to openUrl() */
  buildUrl: (raw: string) => string;
}

function ensureScheme(url: string, scheme: string): string {
  if (url.startsWith(scheme)) return url;
  return `${scheme}${url}`;
}

const PROTOCOL_MAP: Array<{ test: (u: string) => boolean } & ProtocolInfo> = [
  {
    type: "rdp",
    label: "RDP",
    color: "#0078d4",
    openable: true,
    test: u => u.startsWith("rdp://") || /:\s*3389\b/.test(u) || u.startsWith("ms-rd:"),
    buildUrl: u => {
      if (u.startsWith("rdp://") || u.startsWith("ms-rd:")) return u;
      // Build rdp:// from hostname (strip http/https if present)
      const host = u.replace(/^https?:\/\//, "").replace(/:\d+$/, "");
      return `rdp://${host}:3389`;
    },
  },
  {
    type: "ssh",
    label: "SSH",
    color: "#16a34a",
    openable: true,
    test: u => u.startsWith("ssh://"),
    buildUrl: u => ensureScheme(u, "ssh://"),
  },
  {
    type: "vnc",
    label: "VNC",
    color: "#7c3aed",
    openable: true,
    test: u => u.startsWith("vnc://"),
    buildUrl: u => u,
  },
  {
    type: "sftp",
    label: "SFTP",
    color: "#0891b2",
    openable: true,
    test: u => u.startsWith("sftp://"),
    buildUrl: u => u,
  },
  {
    type: "ftp",
    label: "FTP",
    color: "#ea580c",
    openable: true,
    test: u => u.startsWith("ftp://"),
    buildUrl: u => u,
  },
  {
    type: "telnet",
    label: "Telnet",
    color: "#dc2626",
    openable: true,
    test: u => u.startsWith("telnet://"),
    buildUrl: u => u,
  },
  {
    type: "web",
    label: "Web",
    color: "#3b82f6",
    openable: true,
    test: u => u.startsWith("http://") || u.startsWith("https://") || (!u.includes("://") && u.includes(".")),
    buildUrl: u => u.startsWith("http") ? u : `https://${u}`,
  },
];

export function detectProtocol(url: string): ProtocolInfo | null {
  if (!url) return null;
  const u = url.trim().toLowerCase();
  const found = PROTOCOL_MAP.find(p => p.test(u));
  return found ?? { type: "other", label: "Ouvrir", color: "var(--text-3)", openable: true, buildUrl: u => u };
}

export function getDisplayHost(url: string): string {
  try {
    const u = url.startsWith("http") ? url : `https://${url}`;
    return new URL(u).hostname;
  } catch {
    return url;
  }
}
