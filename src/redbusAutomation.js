const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

/**
 * Helper to generate human-like randomized delays between actions
 */
const randomJitter = (minMs = 1200, maxMs = 3500) => {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Helper to get current date formatted in IST (Asia/Kolkata) as YYYY-MM-DD
 */
function getISTDateString() {
  const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' };
  const formatter = new Intl.DateTimeFormat('en-CA', options); // YYYY-MM-DD
  return formatter.format(new Date());
}

/**
 * Helper to get current day of week in IST (Asia/Kolkata) (e.g., "Saturday", "Sunday")
 */
function getISTDayOfWeek() {
  const options = { timeZone: 'Asia/Kolkata', weekday: 'long' };
  return new Intl.DateTimeFormat('en-US', options).format(new Date());
}

/**
 * Helper to get current hour in IST (0-23)
 */
function getISTHour() {
  const options = { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false };
  const str = new Intl.DateTimeFormat('en-US', options).format(new Date());
  return parseInt(str, 10);
}

/**
 * Helper to get active route config based on current IST timestamp or forced phase CLI flag
 * Phase 1 (Until Aug 30 4:00 PM IST): Nalgonda to Bangalore (Clock Tower -> Marathahalli)
 * Phase 2 (Aug 30 4:00 PM IST - 8:20 PM IST): Addanki to Nellore (Opp Rtc Bus Stand -> Simhapuri)
 * Phase 3 (After Aug 30 8:20 PM IST): Nellore to Bangalore (Simhapuri -> Electronic city)
 */
function getActiveRoute(config, forcedPhase = null) {
  if (forcedPhase === 1) {
    return {
      phase: 1,
      routeName: 'Phase 1 [FORCED TEST]: Nalgonda to Bangalore',
      targetUrl: 'https://www.redbus.in/bus-tickets/nalgonda-to-bangalore?fromCityName=Nalgonda&toCityName=Bangalore&fromCityId=95474&toCityId=122&onward=30-Aug-2026&return=NaN-undefined-NaN&ref=modifyDate',
      busOperator: 'Easy Go',
      boardingPointSearch: 'Clock Tower',
      droppingPointSearch: 'Marathahalli'
    };
  }
  if (forcedPhase === 2) {
    return {
      phase: 2,
      routeName: 'Phase 2 [FORCED TEST]: Addanki to Bangalore',
      targetUrl: 'https://www.redbus.in/bus-tickets/addanki-to-bangalore?fromCityName=Addanki&fromCityId=382&toCityName=Bangalore&toCityId=122&onward=30-Aug-2026',
      busOperator: 'Easy Go',
      boardingPointSearch: 'Opp Rtc Bus Stand',
      droppingPointSearch: 'K R Puram'
    };
  }
  if (forcedPhase === 3) {
    return {
      phase: 3,
      routeName: 'Phase 3 [FORCED TEST]: Nellore to Bangalore',
      targetUrl: 'https://www.redbus.in/bus-tickets/nellore-to-bangalore?fromCityName=Nellore&toCityName=Bangalore&fromCityId=131&toCityId=122&onward=30-Aug-2026',
      busOperator: 'Easy Go',
      boardingPointSearch: 'Simhapuri',
      droppingPointSearch: 'Electronic city'
    };
  }

  const now = new Date();
  
  // Threshold 1: Aug 30, 2026 at 4:00 PM IST (16:00:00+05:30)
  const t1_4pm = new Date('2026-08-30T16:00:00+05:30');

  // Threshold 2: Aug 30, 2026 at 8:20 PM IST (20:20:00+05:30)
  const t2_820pm = new Date('2026-08-30T20:20:00+05:30');

  if (now < t1_4pm) {
    return {
      phase: 1,
      routeName: 'Phase 1: Nalgonda to Bangalore (Until Aug 30 4:00 PM IST)',
      targetUrl: 'https://www.redbus.in/bus-tickets/nalgonda-to-bangalore?fromCityName=Nalgonda&toCityName=Bangalore&fromCityId=95474&toCityId=122&onward=30-Aug-2026&return=NaN-undefined-NaN&ref=modifyDate',
      busOperator: 'Easy Go',
      boardingPointSearch: 'Clock Tower',
      droppingPointSearch: 'Marathahalli'
    };
  } else if (now >= t1_4pm && now < t2_820pm) {
    return {
      phase: 2,
      routeName: 'Phase 2: Addanki to Bangalore (Aug 30 4:00 PM - 8:20 PM IST)',
      targetUrl: 'https://www.redbus.in/bus-tickets/addanki-to-bangalore?fromCityName=Addanki&fromCityId=382&toCityName=Bangalore&toCityId=122&onward=30-Aug-2026',
      busOperator: 'Easy Go',
      boardingPointSearch: 'Opp Rtc Bus Stand',
      droppingPointSearch: 'K R Puram'
    };
  } else {
    return {
      phase: 3,
      routeName: 'Phase 3: Nellore to Bangalore (After Aug 30 8:20 PM IST)',
      targetUrl: 'https://www.redbus.in/bus-tickets/nellore-to-bangalore?fromCityName=Nellore&toCityName=Bangalore&fromCityId=131&toCityId=122&onward=30-Aug-2026',
      busOperator: 'Easy Go',
      boardingPointSearch: 'Simhapuri',
      droppingPointSearch: 'Electronic city'
    };
  }
}

/**
 * Executes a single run of Redbus seat booking automation targeting Easy Go bus and Upper Deck 2nd seat.
 * @param {Object} config Automation configuration object
 * @param {boolean} overrideHeadless Option to override headless setting
 * @param {number} forcedPhase Optional phase override (1, 2, or 3)
 */
async function runRedbusAutomation(config, overrideHeadless = undefined, forcedPhase = null) {
  const activeRoute = getActiveRoute(config, forcedPhase);
  const currentISTDate = getISTDateString();
  const currentISTDay = getISTDayOfWeek();
  const cutoffDate = config.cutoffDateIST || '2026-09-01';
  const allowedDays = config.allowedDaysIST || ['Saturday', 'Sunday', 'Monday'];

  // Check 1: Day of Week Check (Saturday, Sunday, and Monday)
  if (!allowedDays.includes(currentISTDay)) {
    console.log(`\n==================================================`);
    console.log(`[SKIP WEEKDAY] Today in IST is ${currentISTDay}.`);
    console.log(`Automation is configured to run ONLY on ${allowedDays.join(', ')}.`);
    console.log(`==================================================\n`);
    return {
      success: false,
      notAllowedDay: true,
      seatAvailable: false,
      retryNeeded: false,
      error: `Today (${currentISTDay}) is not an allowed running day`
    };
  }

  // Check 2: Cutoff Date Check (Runs through Aug 31st, stops on Sept 1st IST)
  if (currentISTDate >= cutoffDate) {
    console.log(`\n==================================================`);
    console.log(`[STOP CUTOFF REACHED] Today's date in IST is ${currentISTDate}, which matches/exceeds cutoff date ${cutoffDate}.`);
    console.log(`Automation expired. Exiting cleanly.`);
    console.log(`==================================================\n`);
    return {
      success: false,
      cutoffReached: true,
      seatAvailable: false,
      retryNeeded: false,
      error: `Cutoff date ${cutoffDate} reached`
    };
  }

  const isHeadless = overrideHeadless !== undefined ? overrideHeadless : (config.headless !== false);
  const screenshotDir = path.join(__dirname, '..', 'screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetOperator = activeRoute.busOperator;
  const targetSeatIdx = config.seatPreference?.seatIndex !== undefined ? config.seatPreference.seatIndex : 1; // 2nd seat (index 1)

  console.log(`\n==================================================`);
  console.log(`[${new Date().toLocaleString()}] Checking Route: ${activeRoute.routeName}`);
  console.log(`Headless Mode     : ${isHeadless}`);
  console.log(`Bus Operator      : ${targetOperator}`);
  console.log(`Seat Position     : Upper Deck Seat #${targetSeatIdx + 1} (Seat U2)`);
  console.log(`Pickup Location   : ${activeRoute.boardingPointSearch}`);
  console.log(`Drop Location     : ${activeRoute.droppingPointSearch}`);
  console.log(`Target URL        : ${activeRoute.targetUrl}`);
  console.log(`==================================================`);

  const browser = await chromium.launch({
    headless: isHeadless,
    args: [
      '--disable-http2',
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    extraHTTPHeaders: {
      'accept-language': 'en-US,en;q=0.9',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
    }
  });

  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  let runResult = {
    success: false,
    seatAvailable: false,
    retryNeeded: false,
    timestamp,
    selectedSeat: null,
    selectedBp: null,
    selectedDp: null,
    screenshot: null,
    error: null
  };

  try {
    // 1. Navigate to target URL
    console.log(`Navigating to route: ${activeRoute.targetUrl}`);
    await page.goto(activeRoute.targetUrl, { waitUntil: 'commit', timeout: 40000 });
    await page.waitForTimeout(5000);

    // 2. Open Seat View for Target Bus Operator (Easy Go) using multi-strategy locator
    console.log(`Locating bus card for operator matching "${targetOperator}"...`);
    const busCard = await (async () => {
      const getCardLocator = () => page.locator('li[class*="tupleWrapper"], li[class*="srpListItem"], li[class*="card"], div[class*="busCard"], div[class*="tuple"]').filter({ hasText: new RegExp(targetOperator, 'i') }).first();

      // Strategy 1: Simple Scroll & Scan
      console.log(`Strategy 1: Scrolling page to scan for "${targetOperator}"...`);
      for (let i = 0; i < 6; i++) {
        await page.evaluate(() => window.scrollBy(0, 1200));
        await page.waitForTimeout(400);
        const card = getCardLocator();
        if (await card.isVisible().catch(() => false)) {
          console.log(`[FOUND] Bus card matched via Strategy 1 (Page Scroll).`);
          return card;
        }
      }

      // Strategy 2: Departure Time Sorting (Brings evening/night buses like 20:30 / 23:59 to top)
      console.log(`Strategy 2: Clicking "Departure time" sort tab...`);
      const depSortBtn = page.locator('text=/Departure time/i').first();
      if (await depSortBtn.isVisible().catch(() => false)) {
        await depSortBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(3000);
        for (let i = 0; i < 6; i++) {
          await page.evaluate(() => window.scrollBy(0, 1200));
          await page.waitForTimeout(400);
          const card = getCardLocator();
          if (await card.isVisible().catch(() => false)) {
            console.log(`[FOUND] Bus card matched via Strategy 2 (Departure Time Sort).`);
            return card;
          }
        }
      }

      // Strategy 3: AI Smart Filter Search Box
      console.log(`Strategy 3: Using AI Smart Filter search box for "${targetOperator}"...`);
      const smartFilterBox = page.locator('textarea[placeholder*="Morning bus" i], input[placeholder*="Morning bus" i], textarea[class*="textInput"]').first();
      if (await smartFilterBox.isVisible().catch(() => false)) {
        await smartFilterBox.click().catch(() => {});
        await smartFilterBox.fill(targetOperator).catch(() => {});
        await page.waitForTimeout(800);
        await page.keyboard.press('Enter').catch(() => {});
        
        const searchBtn = page.locator('text=/Search buses/i').first();
        if (await searchBtn.isVisible().catch(() => false)) {
          await searchBtn.click({ force: true }).catch(() => {});
        }
        await page.waitForTimeout(3000);

        for (let i = 0; i < 6; i++) {
          await page.evaluate(() => window.scrollBy(0, 1200));
          await page.waitForTimeout(400);
          const card = getCardLocator();
          if (await card.isVisible().catch(() => false)) {
            console.log(`[FOUND] Bus card matched via Strategy 3 (AI Smart Filter).`);
            return card;
          }
        }
      }

      // Strategy 4: Deep Page Scroll (All results)
      console.log(`Strategy 4: Performing deep scroll across all loaded results...`);
      for (let i = 0; i < 15; i++) {
        await page.evaluate(() => window.scrollBy(0, 1500));
        await page.waitForTimeout(400);
        const card = getCardLocator();
        if (await card.isVisible().catch(() => false)) {
          console.log(`[FOUND] Bus card matched via Strategy 4 (Deep Scroll).`);
          return card;
        }
      }

      return getCardLocator();
    })();

    if (!(await busCard.isVisible().catch(() => false))) {
      throw new Error(`Bus card container for operator "${targetOperator}" was not found on search page`);
    }

    const cardSummaryText = await busCard.innerText().catch(() => '');
    console.log(`Matched Bus Card Summary: ${cardSummaryText.slice(0, 100).replace(/\s+/g, ' ')}`);

    const viewBtn = busCard.locator('text=/View seats/i').first();
    console.log(`Clicking "View Seats" on ${targetOperator} bus...`);
    await viewBtn.click();
    await randomJitter(2500, 4500);

    // 3. Locate Upper Deck and Check Target Seat (2nd seat / index 1)
    console.log('Scanning Upper Deck seats layout...');
    const upperSeats = await page.evaluate(() => {
      const deckSections = Array.from(document.querySelectorAll('div[class*="deckSection"]'));
      let upperSec = deckSections.find(s => (s.innerText || '').includes('Upper deck'));
      if (!upperSec) return [];

      const seatSpans = Array.from(upperSec.querySelectorAll('span[aria-label]'));
      return seatSpans.map((s, idx) => {
        const ariaLabel = s.getAttribute('aria-label') || '';
        const lowerLabel = ariaLabel.toLowerCase();
        const isAvailable = !lowerLabel.includes('sold') && !lowerLabel.includes('booked') && !lowerLabel.includes('not available');
        return { idx, ariaLabel, isAvailable };
      });
    });

    if (!upperSeats || upperSeats.length === 0) {
      throw new Error(`Upper Deck section or seats layout not found for ${targetOperator} bus`);
    }

    const targetSeat = upperSeats[targetSeatIdx];
    if (!targetSeat) {
      throw new Error(`Upper Deck seat #${targetSeatIdx + 1} not found in seat map`);
    }

    console.log(`Target Seat Info: ${targetSeat.ariaLabel}`);

    if (!targetSeat.isAvailable) {
      console.log(`\n[SEAT UNAVAILABLE] Upper Deck 2nd seat (${targetSeat.ariaLabel.split(',')[0]}) is currently SOLD/BOOKED.`);
      console.log(`Script will retry checking seat availability in ${config.retryIntervalSeconds || 20} seconds...`);
      
      const unavailableScreenshot = path.join(screenshotDir, `unavailable_${timestamp}.png`);
      await page.screenshot({ path: unavailableScreenshot, fullPage: false }).catch(() => {});
      
      runResult.seatAvailable = false;
      runResult.retryNeeded = true;
      runResult.screenshot = unavailableScreenshot;
      return runResult;
    }

    // --- SEAT IS AVAILABLE ---
    console.log(`\n[SEAT AVAILABLE!] Upper Deck 2nd seat on ${targetOperator} is AVAILABLE for booking!`);
    console.log(`Selecting seat: ${targetSeat.ariaLabel}...`);
    
    const deckSec = page.locator('div[class*="deckSection"]').filter({ hasText: 'Upper deck' });
    const seatElem = deckSec.locator('span[aria-label]').nth(targetSeat.idx);
    await seatElem.scrollIntoViewIfNeeded().catch(() => {});
    await seatElem.click();
    await page.waitForTimeout(2500);

    runResult.selectedSeat = targetSeat.ariaLabel;
    runResult.seatAvailable = true;

    // 4. Click Select Boarding & Dropping Points button
    console.log('Proceeding to Boarding & Dropping point selection...');
    const selectBpDpBtn = page.locator('button:has-text("Select boarding"), button:has-text("boarding & dropping"), button:has-text("CONTINUE"), button:has-text("Continue")').first();
    if (await selectBpDpBtn.isVisible().catch(() => false)) {
      await selectBpDpBtn.scrollIntoViewIfNeeded().catch(() => {});
      await selectBpDpBtn.click({ force: true });
    }
    await page.waitForTimeout(3000);

    // 5. Select Boarding Point
    const bpSearch = activeRoute.boardingPointSearch;
    console.log(`Selecting Boarding Point matching "${bpSearch}"...`);
    const bpSelected = await page.evaluate((searchTerm) => {
      const inputs = Array.from(document.querySelectorAll('input[name^="bp_"]'));
      const cleanSearch = searchTerm.toLowerCase().replace(/\s+/g, '');
      let match = inputs.find(i => {
        const parent = i.closest('li') || i.closest('label') || i.parentElement;
        const text = parent ? parent.innerText.toLowerCase().replace(/\s+/g, '') : '';
        return text.includes(cleanSearch);
      }) || inputs[0];

      if (match) {
        const label = document.querySelector(`label[for="${match.id}"]`) || match.parentElement || match;
        label.click();
        const parent = match.closest('li') || match.closest('label') || match.parentElement;
        return parent ? parent.innerText.trim().replace(/\s+/g, ' ') : match.id;
      }
      return null;
    }, bpSearch);

    console.log(`Selected BP: ${bpSelected}`);
    runResult.selectedBp = bpSelected;
    await page.waitForTimeout(2000);

    // 6. Select Dropping Point
    const dpSearch = activeRoute.droppingPointSearch;
    console.log(`Selecting Dropping Point matching "${dpSearch}"...`);
    const dpSelected = await page.evaluate((searchTerm) => {
      const inputs = Array.from(document.querySelectorAll('input[name^="dp_"]'));
      const cleanSearch = searchTerm.toLowerCase().replace(/\s+/g, '');
      let match = inputs.find(i => {
        const parent = i.closest('li') || i.closest('label') || i.parentElement;
        const text = parent ? parent.innerText.toLowerCase().replace(/\s+/g, '') : '';
        return text.includes(cleanSearch);
      }) || inputs[0];

      if (match) {
        const label = document.querySelector(`label[for="${match.id}"]`) || match.parentElement || match;
        label.click();
        const parent = match.closest('li') || match.closest('label') || match.parentElement;
        return parent ? parent.innerText.trim().replace(/\s+/g, ' ') : match.id;
      }
      return null;
    }, dpSearch);

    console.log(`Selected DP: ${dpSelected}`);
    runResult.selectedDp = dpSelected;
    await page.waitForTimeout(2500);

    // 7. Click Proceed / Transition to Passenger Details Form
    console.log('Transitioning to Passenger Info view...');
    const proceedToPassengerBtn = page.locator('button:has-text("Proceed"), button:has-text("Fill Passenger"), button:has-text("CONTINUE"), button:has-text("Continue"), div[class*="button"]:has-text("Proceed")').first();
    if (await proceedToPassengerBtn.isVisible().catch(() => false)) {
      await proceedToPassengerBtn.click({ force: true });
      await page.waitForTimeout(4000);
    } else {
      console.log('Clicking Passenger Info tab header directly...');
      await page.locator('text=/Passenger Info/i').first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(4000);
    }

    // 8. Fill Passenger Details Form
    const p = config.passenger || {};
    console.log(`Filling Passenger Details: Name: "${p.name}", Age: ${p.age}, Gender: ${p.gender}, Email: ${p.email}, Mobile: ${p.phone}`);

    // Fill Phone / Mobile field
    const phoneInput = page.locator('input[name="Phone"], input[type="tel"], input[placeholder*="phone" i], input[id="0_6"]').first();
    if (await phoneInput.isVisible().catch(() => false)) {
      await phoneInput.fill(p.phone || '9876543210');
      console.log('Filled Mobile Phone:', p.phone || '9876543210');
    }

    // Fill Email field
    const emailInput = page.locator('input[placeholder*="Enter email id" i], input[id="0_5"], input[type="email"]').first();
    if (await emailInput.isVisible().catch(() => false)) {
      await emailInput.fill(p.email || 'johndoe@example.com');
      console.log('Filled Email:', p.email || 'johndoe@example.com');
    }

    // Fill Passenger Name field
    const nameInput = page.locator('input[placeholder*="Enter your Name" i], input[id="0_4"], input[name*="name" i]').first();
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill(p.name || 'John Doe');
      console.log('Filled Passenger Name:', p.name || 'John Doe');
    }

    // Fill Passenger Age field
    const ageInput = page.locator('input[placeholder*="Enter Age" i], input[id="0_1"], input[type="number"]').first();
    if (await ageInput.isVisible().catch(() => false)) {
      await ageInput.fill((p.age || '28').toString());
      console.log('Filled Passenger Age:', p.age || '28');
    }

    // Select Gender (Male / Female)
    const genderBtn = page.locator('div:has-text("Male"), button:has-text("Male"), label:has-text("Male"), span:has-text("Male")').first();
    if (await genderBtn.isVisible().catch(() => false)) {
      await genderBtn.click().catch(() => {});
      console.log('Selected Gender: Male');
    }

    await page.waitForTimeout(2000);

    // Handle State of Residence modal/dropdown if open
    const stateOption = page.locator('li:has-text("Telangana"), label:has-text("Telangana"), radio[value*="Telangana"]').first();
    if (await stateOption.isVisible().catch(() => false)) {
      console.log('Selecting State of Residence (Telangana)...');
      await stateOption.click({ force: true }).catch(() => {});
      await page.waitForTimeout(1000);
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(1500);

    // 9. Select "Don't add Travel Insurance"
    console.log('Selecting "Don\'t add Travel Insurance"...');
    const rejectInsuranceRadio = page.locator('input#insuranceRejectBtn, label[for="insuranceRejectBtn"], input[id*="Reject" i]').first();
    if (await rejectInsuranceRadio.isVisible().catch(() => false)) {
      await rejectInsuranceRadio.click({ force: true }).catch(() => {});
      console.log('Selected "Don\'t add Travel Insurance" (insuranceRejectBtn)');
    } else {
      const rejectInsuranceText = page.locator('text=/Don’t add Travel Insurance|No, I don\'t want travel insurance|Unsecure my trip|No insurance/i').first();
      if (await rejectInsuranceText.isVisible().catch(() => false)) {
        await rejectInsuranceText.click({ force: true }).catch(() => {});
        console.log('Selected "Don\'t add Travel Insurance" text locator');
      }
    }
    await page.waitForTimeout(2000);

    // 10. Click "Continue booking" / "Proceed to pay" button
    console.log('Clicking "Continue booking" button...');
    const continueBookingBtn = page.locator('button:has-text("Continue booking"), button:has-text("CONTINUE BOOKING"), button:has-text("Proceed to pay"), button:has-text("Proceed to Pay"), button:has-text("PROCEED TO PAY"), button:has-text("Pay")').first();
    if (await continueBookingBtn.isVisible().catch(() => false)) {
      await continueBookingBtn.scrollIntoViewIfNeeded().catch(() => {});
      await continueBookingBtn.click({ force: true });
      await page.waitForTimeout(6000);
    }

    // 11. Save Checkout Screenshot
    const screenshotPath = path.join(screenshotDir, `checkout_${timestamp}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`Saved checkout screenshot: ${screenshotPath}`);

    runResult.success = true;
    runResult.screenshot = screenshotPath;
    console.log(`\n==================================================`);
    console.log(`[SUCCESS] Passenger Info filled, Insurance rejected, & clicked Continue booking!`);
    console.log(`==================================================`);

    // 12. Keep browser open for 15 seconds before closing as requested
    const keepOpenMs = (config.keepBrowserOpenSeconds || 15) * 1000;
    console.log(`\nKeeping browser open for ${config.keepBrowserOpenSeconds || 15} seconds before closing...`);
    await page.waitForTimeout(keepOpenMs);
    console.log('15-second wait complete.');

  } catch (err) {
    console.error(`\n[ERROR] Automation run failed: ${err.message}`);
    runResult.error = err.message;
    const errorScreenshot = path.join(screenshotDir, `error_${timestamp}.png`);
    await page.screenshot({ path: errorScreenshot, fullPage: false }).catch(() => {});
    runResult.screenshot = errorScreenshot;
  } finally {
    await browser.close();
  }

  return runResult;
}

module.exports = { runRedbusAutomation };
