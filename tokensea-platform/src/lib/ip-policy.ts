import { BlockList, isIP } from "node:net";

export function validIpRule(rule: string): boolean {
  const parts = rule.split("/");
  const version = isIP(parts[0]);
  if (!version || parts.length > 2) return false;
  return parts.length === 1 || (/^\d+$/.test(parts[1]) && Number(parts[1]) <= (version === 4 ? 32 : 128));
}

export function ipAllowed(ip: string, rules: string[]): boolean {
  if (!rules.length) return true;
  const address = ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
  if (!isIP(address)) return false;
  const block = new BlockList();
  for (const rule of rules) {
    if (!validIpRule(rule)) continue;
    const [host, prefix] = rule.split("/");
    const kind = isIP(host) === 4 ? "ipv4" : "ipv6";
    if (prefix === undefined) block.addAddress(host, kind);
    else block.addSubnet(host, Number(prefix), kind);
  }
  return block.check(address, isIP(address) === 4 ? "ipv4" : "ipv6");
}
