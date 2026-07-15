// @ts-ignore
const fs = require("node:fs");
// @ts-ignore
const path = require("node:path");

const WORKERS_CI = process.env.WORKERS_CI;
let R2EXPLORER_WORKER_NAME = process.env.R2EXPLORER_WORKER_NAME;
const R2EXPLORER_BUCKETS = process.env.R2EXPLORER_BUCKETS;
const R2EXPLORER_CONFIG = process.env.R2EXPLORER_CONFIG;
const R2EXPLORER_DOMAIN = process.env.R2EXPLORER_DOMAIN;
const CF_API_TOKEN = process.env.CF_API_TOKEN;

// This repo's own worker/dashboard source, built by `pnpm build` before this
// script runs. Deploying from here (instead of installing the published
// `r2-explorer` npm package) means prod always reflects what's on this
// branch, including local branding/customizations.
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKER_ENTRY = path.join(REPO_ROOT, "packages/worker/src/index.ts");
const DASHBOARD_DIST = path.join(REPO_ROOT, "packages/dashboard/dist/spa");

let baseDir = __dirname;
if (WORKERS_CI === "1") {
	baseDir = process.env.PWD;
	R2EXPLORER_WORKER_NAME = R2EXPLORER_WORKER_NAME || "r2-explorer";
} else {
	if (!CF_API_TOKEN) {
		console.error("CF_API_TOKEN variable is required to continue!");
		process.exit(1);
	}
}

if (!fs.existsSync(DASHBOARD_DIST)) {
	console.error(`Dashboard build not found at ${DASHBOARD_DIST}`);
	console.error("Run `pnpm build` before this script.");
	process.exit(1);
}

if (!R2EXPLORER_WORKER_NAME) {
	console.error("R2EXPLORER_WORKER_NAME variable is required to continue!");
	process.exit(1);
}

if (!R2EXPLORER_BUCKETS) {
	console.error("R2EXPLORER_BUCKETS variable is required to continue!");
	process.exit(1);
}

if (!R2EXPLORER_CONFIG) {
	console.error("R2EXPLORER_CONFIG variable is required to continue!");
	process.exit(1);
}

const assetsDir = path
	.relative(baseDir, DASHBOARD_DIST)
	.split(path.sep)
	.join("/");

let wranglerConfig = `
name = "${R2EXPLORER_WORKER_NAME}"
compatibility_date = "2024-11-06"
main = "src/index.ts"
assets = { directory = "${assetsDir}", binding = "ASSETS", html_handling = "auto-trailing-slash", not_found_handling = "single-page-application", run_worker_first = ["/api/*", "/share/*"] }
`;

if (R2EXPLORER_DOMAIN) {
	wranglerConfig += `
workers_dev = false
routes = [
  { pattern = "${R2EXPLORER_DOMAIN}", custom_domain = true }
]
`;
} else {
	wranglerConfig += `
workers_dev = true
`;
}

for (const rawBucket of R2EXPLORER_BUCKETS.split("\n")) {
  const bucket = rawBucket.trim();
  if (!bucket) continue; // skip empty lines
  const split = bucket.split(":");
  if (split.length !== 2 && split.length !== 3) {
    console.error("R2EXPLORER_BUCKETS is not set correctly!");
    console.error(`"${bucket}" is not in the correct format => ALIAS:BUCKET_NAME[:JURISDICTION]`);
    process.exit(1);
  }

  const [alias, bucketName, jurisdiction] = split;

  wranglerConfig += `
[[r2_buckets]]
binding = '${alias}'
bucket_name = '${bucketName}'
preview_bucket_name = '${bucketName}'
`;
  if (jurisdiction) {
    wranglerConfig += `jurisdiction = '${jurisdiction}'
`;
  }
}

console.log(wranglerConfig);
fs.writeFileSync(`${baseDir}/wrangler.toml`, wranglerConfig);

if (!fs.existsSync(`${baseDir}/src/`)) {
	fs.mkdirSync(`${baseDir}/src/`);
}

const workerEntryImport = path
	.relative(path.join(baseDir, "src"), WORKER_ENTRY)
	.replace(/\.ts$/, "")
	.split(path.sep)
	.join("/");
const workerSource = `
import { R2Explorer } from "${workerEntryImport}";

export default R2Explorer(${R2EXPLORER_CONFIG});
`;

console.log(workerSource);
fs.writeFileSync(`${baseDir}/src/index.ts`, workerSource);
