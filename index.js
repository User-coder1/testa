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

let intervalMinutes = config.intervalMinutes || 5;
const delayPattern = config.retryDelayPatternSeconds || [20, 40, 60];

const overrideHeadless = forceHeadful ? false : undefined;

console.log(`==================================================`);
console.log(` Easy Go Bus - Upper Deck 2nd Seat Automation`);
console.log(`==================================================`);
console.log(` Target Route   : Nalgonda to Bangalore`);
console.log(` Bus Operator   : ${config.busOperator || 'Easy Go'}`);
console.log(` Target Seat    : Upper Deck 2nd Seat (Seat U2)`);
console.log(` Boarding Point : ${config.boardingPointSearch || 'Clock Tower'}`);
console.log(` Dropping Point : ${config.droppingPointSearch || 'Marathahalli'}`);
console.log(` Retry Pattern  : ${delayPattern.join('s -> ')}s (repeating cycle)`);
console.log(` Main Run Interval: Every ${intervalMinutes} minute(s)`);
console.log(` Execution Mode : ${runOnce ? 'Single Run (--once)' : 'Continuous Schedule'}`);
console.log(`==================================================\n`);

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function executeWithSeatRetry() {
  let attempt = 1;
  const maxRetries = config.maxUnavailableRetries || 100;

  while (attempt <= maxRetries) {
    // Get progressive cyclical delay for this attempt
    const currentDelay = delayPattern[(attempt - 1) % delayPattern.length];

    console.log(`--- [Attempt #${attempt}] Checking Upper Deck 2nd seat availability ---`);
    const res = await runRedbusAutomation(config, overrideHeadless);

    if (res.success) {
      console.log(`[SUCCESS] Seat booked and reached Checkout page!`);
      return res;
    }

    if (res.cutoffReached || res.notAllowedDay) {
      console.log(`[STOP] Execution halted (weekday skip or cutoff reached). Stopping retry loop.`);
      return res;
    }

    if (res.retryNeeded && !runOnce) {
      console.log(`\n[RETRY PATTERN] Seat U2 is unavailable. Waiting ${currentDelay} seconds before Attempt #${attempt + 1}... (Pattern cycle: ${delayPattern.join('s -> ')}s)\n`);
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
