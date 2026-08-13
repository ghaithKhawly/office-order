/*
 * Working out the address people should actually type.
 *
 * The app is reached by IP on the office LAN — there is no DNS, no mDNS worth
 * relying on from Android handsets, and no certificate. That address goes on
 * the QR code taped by the door and on the health page, so it has to be the
 * one a phone can really reach, not 127.0.0.1 and not a Docker bridge.
 */
import os from "node:os";

/* Interfaces that are never the office LAN. Hyper-V and WSL leave these behind
   on a Windows box and they sort before the real adapter often enough to
   matter. */
const IGNORE_NAME = /^(lo|docker|br-|veth|vEthernet|VMware|VirtualBox|Loopback)/i;

/** Private ranges, in the order an office network is most likely to use. */
function privateRank(ip) {
  if (ip.startsWith("192.168.")) return 0;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 1;
  if (ip.startsWith("10.")) return 2;
  if (ip.startsWith("169.254.")) return 9; // link-local: an adapter with no DHCP lease
  return 5;
}

/**
 * Every usable IPv4 address, best guess first.
 * @returns {Array<{address:string, iface:string, internal:boolean}>}
 */
export function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs || []) {
      if (a.family !== "IPv4" || a.internal) continue;
      out.push({ address: a.address, iface: name, internal: false });
    }
  }
  return out.sort((a, b) => {
    const ignored = Number(IGNORE_NAME.test(a.iface)) - Number(IGNORE_NAME.test(b.iface));
    if (ignored !== 0) return ignored;
    return privateRank(a.address) - privateRank(b.address);
  });
}

/** The single address to print on a QR code. Falls back to localhost. */
export function bestLanAddress() {
  return lanAddresses()[0]?.address || "localhost";
}

/** The URL a colleague types (or scans) to join. */
export function joinUrl(port) {
  return `http://${bestLanAddress()}:${port}`;
}
