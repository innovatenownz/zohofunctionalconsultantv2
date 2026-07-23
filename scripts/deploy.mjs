import { execSync } from 'node:child_process';

// Parse CLI flags
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const forceEnv = args.find(arg => arg.startsWith('--env='))?.split('=')[1];

function runCommand(command, errorMessage, exitOnFail = true) {
  console.log(`Running: ${command}`);
  try {
    execSync(command, { stdio: 'inherit' });
    return true;
  } catch {
    if (exitOnFail) {
      console.error(`\nERROR: ${errorMessage}`);
      process.exit(1);
    } else {
      console.warn(`\nWARNING: ${errorMessage}`);
      return false;
    }
  }
}

// 1. Determine Git Branch, Environment, and Commit SHA
let branch = '';
try {
  branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
} catch {
  console.error('Failed to get current git branch. Make sure you are in a git repository.');
  process.exit(1);
}

let commitSha = 'unknown';
try {
  commitSha = execSync('git rev-parse --short HEAD').toString().trim().toLowerCase();
} catch {
  console.warn('Could not determine git commit SHA.');
}

console.log(`Current branch detected: ${branch}`);
console.log(`Current commit SHA:      ${commitSha}`);

let env = '';
let serviceName = '';
let configFile = '';
const region = 'asia-south1';

if (forceEnv) {
  env = forceEnv;
} else if (branch === 'main') {
  env = 'production';
} else if (branch === 'pre-production') {
  env = 'preprod';
} else {
  console.error(`Unsupported deployment branch: "${branch}". Deployments are only allowed from "main" (production) or "pre-production" (preprod).`);
  console.log('To override, use: node scripts/deploy.mjs --env=preprod or --env=production');
  process.exit(1);
}

if (env === 'production') {
  serviceName = 'zoho-consultant-agent'; // Kept as original active production service
  configFile = 'env.production.yaml';
} else if (env === 'preprod') {
  serviceName = 'zoho-consultant-agent-pre-production';
  configFile = 'env.preprod.yaml';
}

// Cloud Run tags + service name combined cannot exceed 46 characters.
// "zoho-consultant-agent-pre-production" is 36 chars. Using "v" prefix with 7-char SHA is 8 chars (total 44), fitting safely under the limit.
const revisionTag = `v${commitSha}`;

console.log('\n========================================');
console.log(`Target Environment: ${env.toUpperCase()}`);
console.log(`Target Service:     ${serviceName}`);
console.log(`Target Region:      ${region}`);
console.log(`Config File:        ${configFile}`);
console.log(`Revision Tag:       ${revisionTag}`);
console.log('========================================\n');

// 2. Perform Code Quality and Test Checks
console.log('--- Step 1/3: Running Linting ---');
runCommand('npm run lint', 'Linting returned errors/warnings (ignoring non-fatal check).', false);

console.log('\n--- Step 2/3: Compiling Production Build ---');
runCommand('npm run build', 'Next.js compilation failed.');

console.log('\n--- Step 3/3: Running Playwright E2E Tests ---');
runCommand('npx playwright test', 'Playwright E2E tests failed.');

// 3. Perform Deployment
const deployCommand = `gcloud run deploy ${serviceName} --source . --region ${region} --env-vars-file ${configFile} --tag=${revisionTag} --allow-unauthenticated`;

if (isDryRun) {
  console.log('\n[DRY RUN] All validation checks passed successfully! Deployment command that would run:');
  console.log(deployCommand);
} else {
  console.log(`\nStarting Deployment to Cloud Run (${serviceName}) with revision tag (${revisionTag})...`);
  runCommand(deployCommand, `Failed to deploy service "${serviceName}" to Google Cloud Run.`);
  console.log(`\n🎉 Successfully deployed to ${serviceName} with tag ${revisionTag}!`);
}
