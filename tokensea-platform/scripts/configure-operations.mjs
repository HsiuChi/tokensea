// Run only on the production host, with /platform and /infra/config bind mounts.
// No secrets are printed or committed. Existing management credentials are reused.
import fs from "node:fs";
const configPath = "/infra/config/config.yaml";
const envPath = "/platform/.env";
const config = fs.readFileSync(configPath, "utf8");
const env = fs.readFileSync(envPath, "utf8");
const match = config.match(/^\s*secret-key:\s*(.*?)\s*$/m);
const secret = match?.[1]?.replace(/^["']|["']$/g,"");
if (!secret || !/^[A-Za-z0-9_-]{12,}$/.test(secret)) throw new Error("Existing CPA management secret is unavailable; no changes made");
if (!/allow-remote:\s*(false|true)/.test(config)) throw new Error("Unrecognized CPA config");
if (!process.argv.includes("--apply")) {console.log("Dry run: existing secret reusable, no public ports required");process.exit(0)}
const tag = Date.now();
fs.writeFileSync("/tmp/operations-env-" + tag, env, {mode:0o600});
fs.writeFileSync("/tmp/operations-cpa-" + tag, config, {mode:0o600});
const values = {
  CPA_MANAGEMENT_KEY: secret,
  CPA_MANAGEMENT_URL: "http://tokensea-infra-cpa:8080",
  TRUSTED_PROXY_CIDRS: process.env.TRUSTED_PROXY_CIDRS || "172.18.0.0/16",
};
let next = env;
for (const [key,value] of Object.entries(values)) {
  const line = key + "=" + value;
  const regex = new RegExp("^" + key + "=.*$", "m");
  next = regex.test(next) ? next.replace(regex,line) : next.trimEnd() + "\n" + line + "\n";
}
fs.writeFileSync(envPath,next,{mode:0o600});
fs.writeFileSync(configPath,config.replace(/allow-remote:\s*(false|true)/,"allow-remote: true"));
console.log("Configured internal CPA management and trusted proxy; backup tag " + tag);
