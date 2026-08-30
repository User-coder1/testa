const path = require('path');
const fs = require('fs');
const { runRedbusAutomation } = require('./src/redbusAutomation');

// Load Configuration
const configPath = path.join(__dirname, 'config.json');
let config = {};
if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} else {
  console.error('config.json not found!');
  process.exit(1);
}

// Parse Command Line Arguments
const args = process.argv.slice(2);
const runOnce = args.includes('--once');
const forceHeadful = args.includes('--headful');

// Parse --max-duration flag (e.g., --max-duration 5)
const maxDurIdx = args.indexOf('--max-duration');
const maxDurationMinutes = maxDurIdx !== -1 && args[maxDurIdx + 1] ? parseFloat(args[maxDurIdx + 1]) : null;

// Parse --phase flag (e.g., --phase 1, --phase 2, --phase 3, or --phase auto)
const phaseIdx = args.indexOf('--phase');
const phaseVal = phaseIdx !== -1 && args[phaseIdx + 1] ? args[phaseIdx + 1] : null;
const forcedPhase = (phaseVal && phaseVal !== 'auto') ? parseInt(phaseVal, 10) : null;

let intervalMinutes = config.intervalMinutes || 7;
const delayPattern = config.retryDelayPatternSeconds || [20, 40, 60];
const overrideHeadless = forceHeadful ? false : undefined;

console.log(`==================================================`);
console.log(` Easy Go Bus - Upper Deck 2nd Seat Automation`);
console.log(`==================================================`);
console.log(` Bus Operator   : ${config.busOperator || 'Any'}`);
console.log(` Departure Time : ${config.departureTime}`);
console.log(` Target Seat    : Upper Deck 2nd Seat (Seat ${config.targetSeatNumber || 'U2'})`);
console.log(` Phase Mode     : ${forcedPhase ? `Forced Phase ${forcedPhase}` : 'Auto (Time-based Schedule)'}`);
console.log(` Retry Pattern  : ${delayPattern.join('s -> ')}s (repeating cycle)`);
console.log(` Execution Mode : ${runOnce ? 'Single Run (--once)' : maxDurationMinutes ? `Active Loop (${maxDurationMinutes} mins)` : 'Continuous Schedule'}`);
console.log(`==================================================\n`);

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function executeWithSeatRetry() {
  let attempt = 1;
  const maxRetries = config.maxUnavailableRetries || 100;
  const startTime = Date.now();

  while (attempt <= maxRetries) {
    if (maxDurationMinutes) {
      const elapsedMins = (Date.now() - startTime) / (1000 * 60);
      if (elapsedMins >= maxDurationMinutes) {
        console.log(`\n[MAX DURATION REACHED] Run time limit of ${maxDurationMinutes} minute(s) reached. Exiting current execution window.\n`);
        return { success: false, timeoutReached: true };
      }
    }

    const currentDelay = delayPattern[(attempt - 1) % delayPattern.length];
    console.log(`--- [Attempt #${attempt}] Checking seat availability ---`);
    
    const res = await runRedbusAutomation(config, overrideHeadless, forcedPhase);

    if (res.success) {
      console.log(`[SUCCESS] Seat booked and reached Checkout page!`);
      return res;
    }

    if (res.cutoffReached) {
      console.log(`[STOP] Execution halted (cutoff time reached). Stopping retry loop.`);
      return res;
    }

    if (res.retryNeeded && !runOnce) {
      console.log(`\n[RETRY PATTERN] Target seat is unavailable. Waiting ${currentDelay} seconds before Attempt #${attempt + 1}... (Pattern cycle: ${delayPattern.join('s -> ')}s)\n`);
      await sleep(currentDelay * 1000);
      attempt++;
    } else {
      if (runOnce) {
        console.log(`Single run (--once) complete. Result: ${res.seatAvailable === false ? 'Seat currently unavailable/sold.' : 'Failed'}`);
      }
      return res;
    }
  }
}

if (runOnce) {
  executeWithSeatRetry().then(() => {
    console.log('Single run complete. Exiting.');
    process.exit(0);
  });
} else if (maxDurationMinutes) {
  executeWithSeatRetry().then(() => {
    console.log(`Max duration execution complete. Exiting.`);
    process.exit(0);
  });
} else {
  // Execute immediately on startup
  executeWithSeatRetry().then(() => {
    const intervalMs = intervalMinutes * 60 * 1000;
    console.log(`\nScheduled next main cycle in ${intervalMinutes} minute(s)... Press Ctrl+C to stop.\n`);
    setInterval(() => {
      executeWithSeatRetry();
    }, intervalMs);
  });
}