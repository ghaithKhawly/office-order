/*
 * Working out the address people should actually type.
 *
 * The app is reached by IP on the office LAN — there is no DNS, no mDNS worth
 * relying on from Android handsets, and no certificate. That address goes on
 * the QR code taped by the door and on the health page, so it has to be the
 * one a phone can really reach, not 127.0.0.1 and not a Docker bridge.
 */
import os from "node:os";

/*
 * Interfaces that are not the office LAN, deprioritised rather than hidden.
 *
 * Two families, both of which really do sort ahead of the physical adapter:
 *
 *  - Virtual switches. Hyper-V, WSL, VMware, VirtualBox and Docker all leave
 *    adapters behind on a Windows box.
 *  - VPN tunnels. This is not hypothetical — the machine this was built on
 *    listed a VPN adapter first, which would have put an address no office
 *    phone can reach onto the QR code taped by the door.
 *
 * Getting this wrong is expensive: the failure is a QR that scans, resolves to
 * nothing, and gives nobody on site a clue why.
 */
const IGNORE_NAME =
  /^(lo|docker|br-|veth|vEthernet|VMware|VirtualBox|Loopback)|(tun|tap|vpn|wg|wireguard|zerotier|tailscale|openvpn|hamachi|radmin|protun|nordlynx)/i;

/* Physical office adapters, in the order to prefer them. */
const PREFER_NAME = /^(eth|en|Ethernet|Wi-?Fi|wlan|wl)/i;

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
    // Tunnels and virtual switches last, whatever their address looks like.
    const ignored = Number(IGNORE_NAME.test(a.iface)) - Number(IGNORE_NAME.test(b.iface));
    if (ignored !== 0) return ignored;
    // Then real Ethernet/Wi-Fi ahead of anything unrecognised.
    const preferred = Number(PREFER_NAME.test(b.iface)) - Number(PREFER_NAME.test(a.iface));
    if (preferred !== 0) return preferred;
    return privateRank(a.address) - privateRank(b.address);
  });
}

/**
 * The single address to print on a QR code.
 *
 * PUBLIC_HOST overrides the guess entirely. On a box with an unusual adapter
 * layout — or once the machine has the static IP the deployment guide asks for
 * — being able to pin this in .env beats hoping the heuristic is right, because
 * nobody on site can debug a wrong QR code.
 */
export function bestLanAddress() {
  const override = String(process.env.PUBLIC_HOST || "").trim();
  if (override) return override;
  return lanAddresses()[0]?.address || "localhost";
}

/** The URL a colleague types (or scans) to join. */
export function joinUrl(port) {
  return `http://${bestLanAddress()}:${port}`;
}
