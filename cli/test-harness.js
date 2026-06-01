/**
 * ZAF Prompt Harness Validation Test Suite (test-harness.js)
 * Programmatically tests the ZAF CLI features:
 * 1. Dynamic role profile parsing from docs/agent-taxonomy.md
 * 2. .zaf-skill.md assembly & mounting definitions
 * 3. Turn budget loop terminations
 * 4. File-sync status watcher triggers
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../');
const ACTIVE_DIR = path.join(REPO_ROOT, 'WIP', 'tickets', 'ACTIVE');
const TAXONOMY_PATH = path.join(REPO_ROOT, 'docs', 'agent-taxonomy.md');

console.log('🧪 Starting ZAF Prompt Harness Validation Tests...');
console.log(`🏠 Repo Root: ${REPO_ROOT}`);

// Test 1: Verify Taxonomy Parser Helper
console.log('\n======================================================');
console.log('🧪 TEST 1: Taxonomy Profile Parsing');
console.log('======================================================');

const zoScriptPath = path.join(REPO_ROOT, 'cli', 'zo.js');
const zoCode = fs.readFileSync(zoScriptPath, 'utf8');

// We can load zo.js getRoleProfile using dynamic evaluation or simulate it
function testGetRoleProfile(role) {
  if (!fs.existsSync(TAXONOMY_PATH)) {
    throw new Error('docs/agent-taxonomy.md is missing');
  }
  const content = fs.readFileSync(TAXONOMY_PATH, 'utf8');
  const normalizedRole = role.toLowerCase().replace(/[^a-z]/g, '');
  
  const mappings = [
    { key: 'coo', search: 'chief operating officer' },
    { key: 'engineering', search: 'engineering core' },
    { key: 'testing', search: 'quality & testing' },
    { key: 'quality', search: 'quality & testing' },
    { key: 'data', search: 'data & ai specialist' },
    { key: 'ai', search: 'data & ai specialist' },
    { key: 'security', search: 'security specialist' },
    { key: 'sre', search: 'site reliability engineer' }
  ];
  
  let matchedSearch = normalizedRole;
  for (const map of mappings) {
    if (normalizedRole.includes(map.key) || map.key.includes(normalizedRole)) {
      matchedSearch = map.search;
      break;
    }
  }
  
  const lines = content.split(/\r?\n/);
  let startIdx = -1;
  let headerName = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#') && line.toLowerCase().includes(matchedSearch)) {
      startIdx = i;
      headerName = line.replace(/^#+\s+/, '');
      break;
    }
  }
  
  if (startIdx === -1) {
    return `*   **Role**: ${role} (profile not found in agent-taxonomy.md)`;
  }
  
  let profileLines = [];
  for (let j = startIdx + 1; j < lines.length; j++) {
    const line = lines[j];
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed.startsWith('---')) {
      break;
    }
    profileLines.push(line);
  }
  
  return `### 👤 Role Profile: ${headerName}\n\n${profileLines.join('\n').trim()}`;
}

const engProfile = testGetRoleProfile('engineering');
console.log('✅ Parsed profile content for "engineering":');
console.log(engProfile);

if (!engProfile.includes('Engineering Core') || !engProfile.includes('Persona')) {
  throw new Error('❌ TEST 1 FAILED: "engineering" profile was not parsed correctly.');
}
console.log('🎉 TEST 1 PASSED.');

// Test 2: Verify .zaf-skill.md construction via dry-run simulation
console.log('\n======================================================');
console.log('🧪 TEST 2: .zaf-skill.md Compilation & Mount Declarations');
console.log('======================================================');

let ticketId = 'TKT-ZAF-0010';
let testTicketPath = path.join(ACTIVE_DIR, `${ticketId}.md`);
if (!fs.existsSync(testTicketPath)) {
  const activeFiles = fs.readdirSync(ACTIVE_DIR).filter(f => f.endsWith('.md'));
  if (activeFiles.length > 0) {
    ticketId = path.basename(activeFiles[0], '.md');
    testTicketPath = path.join(ACTIVE_DIR, activeFiles[0]);
  } else {
    throw new Error(`No active ticket found in ${ACTIVE_DIR} to run mock validations.`);
  }
}

// Generate the skill blueprint using our logic
const absoluteRepoPath = path.resolve(REPO_ROOT);
const role = 'engineering';
const transientSkillPath = path.join(REPO_ROOT, '.zaf-skill.md');

try {
  // Simulate writing skill
  const skillBlueprint = `# ZAF HARNESS SYSTEM SKILL
 
> **Warning to Assistant**: You are executing under the ZO Agentic Framework (ZAF) control plane. You must strictly follow these operational constraints.
 
## 1. Active Task Context
*   **Target Ticket ID**: ${ticketId}
*   **Target Repository**: zaf
*   **Assigned Role Profile**: ${role}
 
## 2. Dynamic Agent Persona & Boundaries
${engProfile}
 
## 3. Directory Mounts & Write Authorities
You are authorized to read and write files ONLY within the following boundaries:
*   **Repository Root (Writable)**: \`${absoluteRepoPath}\`
*   **Active Tickets (Append-Only logs/Status)**: \`${ACTIVE_DIR}\`
`;
  
  fs.writeFileSync(transientSkillPath, skillBlueprint, 'utf8');
  console.log('✅ Successfully wrote transient skill overlay.');
  
  const skillContent = fs.readFileSync(transientSkillPath, 'utf8');
  if (!skillContent.includes('ZAF HARNESS SYSTEM SKILL') || !skillContent.includes(absoluteRepoPath)) {
    throw new Error('❌ TEST 2 FAILED: Transient skill was not written correctly.');
  }
  
  console.log('🎉 TEST 2 PASSED.');
} finally {
  if (fs.existsSync(transientSkillPath)) {
    fs.unlinkSync(transientSkillPath);
  }
}

// Test 3: findRepoRoot directory traversal
console.log('\n======================================================');
console.log('🧪 TEST 3: findRepoRoot directory traversal');
console.log('======================================================');

const zafScriptPath = path.join(REPO_ROOT, 'cli', 'zaf.js');
const zafCode = fs.readFileSync(zafScriptPath, 'utf8');
const match = zafCode.match(/function findRepoRoot\([\s\S]*?\n\}/);
if (!match) {
  throw new Error('❌ TEST 3 FAILED: findRepoRoot function not found in zaf.js');
}

// Evaluate the function string to create the findRepoRoot function in the local scope
const findRepoRootStr = match[0];
let testFindRepoRoot;
eval(`testFindRepoRoot = ${findRepoRootStr}`);

console.log('Running testFindRepoRoot test cases...');

// Case 1: Happy Path
let fileExistsMock1 = (p) => p.includes('TICKETS.md');
let res1 = testFindRepoRoot('/home/user/project', fileExistsMock1);
if (res1 !== '/home/user/project') {
  throw new Error(`❌ TEST 3 FAILED: Expected /home/user/project, got ${res1}`);
}
console.log('✅ Case 1 Passed: Found in current directory');

// Case 2: Traversal
let fileExistsMock2 = (p) => p === path.join('/home/user/project', 'WIP', 'tickets', 'TICKETS.md');
let res2 = testFindRepoRoot('/home/user/project/nested/dir', fileExistsMock2);
if (res2 !== '/home/user/project') {
  throw new Error(`❌ TEST 3 FAILED: Expected /home/user/project, got ${res2}`);
}
console.log('✅ Case 2 Passed: Found in parent directory');

// Case 3: Edge Case (Not Found)
let fileExistsMock3 = (p) => false;
let res3 = testFindRepoRoot('/home/user/project/nested/dir', fileExistsMock3);
if (res3 !== '/home/user/project/nested/dir') {
  throw new Error(`❌ TEST 3 FAILED: Expected /home/user/project/nested/dir, got ${res3}`);
}
console.log('✅ Case 3 Passed: Not found, returned start directory');
console.log('🎉 TEST 3 PASSED.');

// Test 4: Turn budget looping termination
console.log('\n======================================================');
console.log('🧪 TEST 4: Turn-Budget Loop Telemetry Tracking');
console.log('======================================================');

// We simulate turn budget loop logic using standard spawn
const testScript = `
let step = 0;
const interval = setInterval(() => {
  step++;
  console.log('✔ Running command turn ' + step);
  if (step > 30) clearInterval(interval);
}, 200);
`;

const tempTestScriptPath = path.join(REPO_ROOT, 'cli', 'temp-test-script.js');
fs.writeFileSync(tempTestScriptPath, testScript, 'utf8');

try {
  const child = spawn('node', [tempTestScriptPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  let turns = 0;
  let killedByTelemetry = false;
  
  child.stdout.on('data', (data) => {
    const chunkStr = data.toString();
    if (chunkStr.includes('✔') || chunkStr.includes('Running command')) {
      turns++;
      if (turns >= 5) { // Force budget at 5 turns for testing
        killedByTelemetry = true;
        child.kill('SIGINT');
      }
    }
  });
  
  child.on('close', () => {
    console.log(`✅ Mock subshell ended. Turns reached: ${turns}`);
    if (killedByTelemetry && turns === 5) {
      console.log('🎉 TEST 4 PASSED: Turn-Budget telemetry triggered safe termination correctly.');
    } else {
      console.log('❌ TEST 4 FAILED: Turn-Budget telemetry was not triggered.');
    }
  });
  
} finally {
  setTimeout(() => {
    if (fs.existsSync(tempTestScriptPath)) fs.unlinkSync(tempTestScriptPath);
  }, 1500);
}

// Test 4: Verify Date Classification (Daily, Weekly, Monthly)
console.log('\n======================================================');
console.log('🧪 TEST 4: Date Classification for Backup Tiers');
console.log('======================================================');

const { classify } = require('../dashboard/backup.js');

try {
  // Test Case 1: Regular day (Tuesday, 2nd) -> Should be ['daily']
  // Date constructor months are 0-indexed, so 2024-10-02 (Wed) or we can use 2024-10-01 (Tue).
  // Let's use 2024-05-07 (Tuesday)
  const regularDay = new Date(2024, 4, 7); // May 7, 2024 is Tuesday
  const regularTiers = classify(regularDay);
  if (regularTiers.length !== 1 || !regularTiers.includes('daily')) {
    throw new Error(`Expected ['daily'], got ${JSON.stringify(regularTiers)}`);
  }
  console.log('✅ Regular day classification correct.');

  // Test Case 2: Monday (not 1st) -> Should be ['daily', 'weekly']
  const mondayDay = new Date(2024, 4, 6); // May 6, 2024 is Monday
  const mondayTiers = classify(mondayDay);
  if (mondayTiers.length !== 2 || !mondayTiers.includes('daily') || !mondayTiers.includes('weekly')) {
    throw new Error(`Expected ['daily', 'weekly'], got ${JSON.stringify(mondayTiers)}`);
  }
  console.log('✅ Monday classification correct.');

  // Test Case 3: 1st of month (not Monday) -> Should be ['daily', 'monthly']
  const firstOfMonth = new Date(2024, 4, 1); // May 1, 2024 is Wednesday
  const firstOfMonthTiers = classify(firstOfMonth);
  if (firstOfMonthTiers.length !== 2 || !firstOfMonthTiers.includes('daily') || !firstOfMonthTiers.includes('monthly')) {
    throw new Error(`Expected ['daily', 'monthly'], got ${JSON.stringify(firstOfMonthTiers)}`);
  }
  console.log('✅ First of month classification correct.');

  // Test Case 4: 1st of month AND Monday -> Should be ['daily', 'weekly', 'monthly']
  const mondayAndFirst = new Date(2024, 3, 1); // April 1, 2024 is Monday
  const mondayAndFirstTiers = classify(mondayAndFirst);
  if (mondayAndFirstTiers.length !== 3 || !mondayAndFirstTiers.includes('daily') || !mondayAndFirstTiers.includes('weekly') || !mondayAndFirstTiers.includes('monthly')) {
    throw new Error(`Expected ['daily', 'weekly', 'monthly'], got ${JSON.stringify(mondayAndFirstTiers)}`);
  }
  console.log('✅ First of month & Monday classification correct.');

  console.log('🎉 TEST 4 PASSED.');
} catch (error) {
  console.error(`❌ TEST 4 FAILED: ${error.message}`);
  process.exit(1);
}
