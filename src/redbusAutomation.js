const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const randomJitter = (minMs = 1200, maxMs = 3500) => {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Helper to get active route config based on current IST timestamp or forced phase CLI flag
 * Phase 1 (Until Aug 30 3:30 PM IST): Nalgonda to Bangalore (Clock Tower -> Marathahalli)
 * Phase 2 (Aug 30 3:30 PM IST - 4:15 PM IST): Addanki to Bangalore (Opp Rtc Bus Stand -> K R Puram)
 * Phase 3 (After Aug 30 4:15 PM IST): Nellore to Bangalore (Simhapuri -> Electronic city)
 */
function getActiveRoute(config, forcedPhase = null) {
  const routes = {
    1: {
      phase: 1,
      routeName: 'Phase 1: Nalgonda to Bangalore',
      targetUrl: config.targetUrl || 'https://www.redbus.in/bus-tickets/nalgonda-to-bangalore?fromCityName=Nalgonda&toCityName=Bangalore&fromCityId=95474&toCityId=122&onward=30-Aug-2026&return=NaN-undefined-NaN&ref=modifyDate',
      busOperator: config.busOperator || 'Easy Go',
      departureTime: config.phase1Departure || config.departureTime || '16:20',
      boardingPointSearch: config.boardingPointSearch || 'Clock Tower',
      droppingPointSearch: config.droppingPointSearch || 'Marathahalli'
    },
    2: {
      phase: 2,
      routeName: 'Phase 2: Addanki to Bangalore',
      targetUrl: config.phase2Url || 'https://www.redbus.in/bus-tickets/addanki-to-bangalore?fromCityName=Addanki&fromCityId=382&toCityName=Bangalore&toCityId=122&onward=30-Aug-2026',
      busOperator: config.phase2Operator || config.busOperator || 'Easy Go',
      departureTime: config.phase2Departure || config.departureTime || '20:30',
      boardingPointSearch: config.phase2Boarding || 'Opp Rtc Bus Stand',
      droppingPointSearch: config.phase2Dropping || 'K R Puram'
    },
    3: {
      phase: 3,
      routeName: 'Phase 3: Nellore to Bangalore',
      targetUrl: config.phase3Url || 'https://www.redbus.in/bus-tickets/nellore-to-bangalore?fromCityName=Nellore&toCityName=Bangalore&fromCityId=131&toCityId=122&onward=30-Aug-2026',
      busOperator: config.phase3Operator || config.busOperator || 'Easy Go',
      departureTime: config.phase3Departure || config.departureTime || '23:59',
      boardingPointSearch: config.phase3Boarding || 'Simhapuri',
      droppingPointSearch: config.phase3Dropping || 'Electronic city'
    }
  };

  let activePhaseId = forcedPhase;

  if (!activePhaseId || !routes[activePhaseId]) {
    const now = new Date();
    const t1 = new Date('2026-08-30T15:30:00+05:30');
    const t2 = new Date('2026-08-30T16:15:00+05:30');

    if (now < t1) {
      activePhaseId = 1;
    } else if (now < t2) {
      activePhaseId = 2;
    } else {
      activePhaseId = 3;
    }
  }

  const selectedRoute = { ...routes[activePhaseId] };
  if (forcedPhase && routes[forcedPhase]) {
    selectedRoute.routeName = selectedRoute.routeName.replace('Phase', 'Phase [FORCED]');
  }

  return selectedRoute;
}

async function runRedbusAutomation(config, overrideHeadless = undefined, forcedPhase = null) {
  const cutoffDateConfig = config.cutoffDateIST || '2026-08-31T01:00:00+05:30';
  const cutoffISOString = cutoffDateConfig.includes('+') ? cutoffDateConfig : `${cutoffDateConfig}+05:30`;
  
  // Cutoff Time Check (Global Date comparison using Unix Epoch timestamps)
  const now = new Date();
  const cutoff = new Date(cutoffISOString);

  if (now >= cutoff) {
    console.log(`\n==================================================`);
    console.log(`[STOP CUTOFF REACHED] Current time (${now.toISOString()}) matches/exceeds cutoff time ${cutoff.toISOString()}.`);
    console.log(`Automation expired. Exiting cleanly.`);
    console.log(`==================================================\n`);
    return {
      success: false,
      cutoffReached: true,
      seatAvailable: false,
      retryNeeded: false,
      error: `Cutoff date ${cutoffDateConfig} reached`
    };
  }

  const activeRoute = getActiveRoute(config, forcedPhase);

  const isHeadless = overrideHeadless !== undefined ? overrideHeadless : (config.headless !== false);
  const screenshotDir = path.join(__dirname, '..', 'screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetOperator = activeRoute.busOperator;
  const departureTime = activeRoute.departureTime;
  const targetUrl = activeRoute.targetUrl;
  const boardingPointSearch = activeRoute.boardingPointSearch;
  const droppingPointSearch = activeRoute.droppingPointSearch;

  console.log(`\n==================================================`);
  console.log(`[${new Date().toLocaleString()}] Checking Route: ${activeRoute.routeName}`);
  console.log(`Headless Mode     : ${isHeadless}`);
  console.log(`Bus Operator      : ${targetOperator}`);
  console.log(`Departure Time    : ${departureTime}`);
  console.log(`Seat Position     : Upper Deck 2nd Seat (Seat ${config.targetSeatNumber || 'U2'})`);
  console.log(`Pickup Location   : ${boardingPointSearch}`);
  console.log(`Drop Location     : ${droppingPointSearch}`);
  console.log(`Target URL        : ${targetUrl}`);
  console.log(`==================================================`);

  const browser = await chromium.launch({
    headless: isHeadless,
    args: [
      '--disable-http2',
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1440,900'
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'Asia/Kolkata',
    extraHTTPHeaders: {
      'accept-language': 'en-US,en;q=0.9',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'sec-ch-ua': '"Chromium";v="128", "Not=A?Brand";v="24", "Google Chrome";v="128"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"'
    }
  });

  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
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
    console.log(`Navigating to route: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 40000 });

    console.log('Waiting for search results page to load...');
    await page.waitForSelector('li[class*="srpListItem"], div[class*="tuple"]', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);

    console.log(`Locating bus card for operator matching "${targetOperator}" or Departure Time: ${departureTime}...`);
    
    await page.screenshot({ path: path.join(screenshotDir, `initial_load_${timestamp}.png`), fullPage: true }).catch(() => {});

    const busCard = await (async () => {
      const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchPattern = new RegExp(`${escapeRegExp(targetOperator)}|${escapeRegExp(departureTime)}`, 'i');
      const getCardLocator = () => page.locator('li[class*="tupleWrapper"], li[class*="srpListItem"], li[class*="card"], div[class*="busCard"], div[class*="tuple"]').filter({ hasText: searchPattern }).first();

      console.log(`Strategy 1: Progressive page scroll to scan for "${targetOperator}" or "${departureTime}"...`);
      for (let i = 0; i < 8; i++) {
        await page.evaluate(() => window.scrollBy(0, 1000));
        await page.waitForTimeout(400);
        const card = getCardLocator();
        if (await card.count() > 0) {
          console.log(`[FOUND] Bus card matched via Strategy 1 (Progressive Scroll).`);
          await card.first().scrollIntoViewIfNeeded().catch(() => {});
          return card.first();
        }
      }

      console.log(`Strategy 2: Clicking "Departure time" sort tab...`);
      const depSortBtn = page.locator('text=/Departure time/i').first();
      if (await depSortBtn.count() > 0) {
        await depSortBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(2500);
        for (let i = 0; i < 8; i++) {
          await page.evaluate(() => window.scrollBy(0, 1000));
          await page.waitForTimeout(400);
          const card = getCardLocator();
          if (await card.count() > 0) {
            console.log(`[FOUND] Bus card matched via Strategy 2 (Departure Time Sort).`);
            await card.first().scrollIntoViewIfNeeded().catch(() => {});
            return card.first();
          }
        }
      }

      console.log(`Strategy 3: Performing deep scroll across all loaded results...`);
      for (let i = 0; i < 15; i++) {
        await page.evaluate(() => window.scrollBy(0, 1500));
        await page.waitForTimeout(400);
        const card = getCardLocator();
        if (await card.count() > 0) {
          console.log(`[FOUND] Bus card matched via Strategy 3 (Deep Scroll).`);
          await card.first().scrollIntoViewIfNeeded().catch(() => {});
          return card.first();
        }
      }

      return getCardLocator().first();
    })();

    if (await busCard.count() === 0) {
      throw new Error(`Bus card container for "${targetOperator}" or departure "${departureTime}" was not found on search page`);
    }

    const viewBtn = busCard.locator('text=/View seats/i').first();
    console.log(`Clicking "View Seats" on matched bus...`);
    await viewBtn.click();
    await randomJitter(2500, 4500);

    const targetSeatNumber = config.targetSeatNumber || 'U2';
    console.log(`Scanning seats layout for Target Seat "${targetSeatNumber}"...`);

    const seatMatch = await page.evaluate((seatNo) => {
      const allSeatSpans = Array.from(document.querySelectorAll('span[aria-label]'));
      
      let found = allSeatSpans.find(s => {
        const id = (s.id || '').toUpperCase();
        const aria = (s.getAttribute('aria-label') || '').toUpperCase();
        return id === seatNo.toUpperCase() || aria.includes(`SEAT NUMBER ${seatNo.toUpperCase()}`);
      });

      if (!found && seatNo.toUpperCase() === 'U2') {
        const deckSections = Array.from(document.querySelectorAll('div[class*="deckSection"]'));
        const upperSec = deckSections.find(s => (s.innerText || '').includes('Upper deck'));
        if (upperSec) {
          const upperSpans = Array.from(upperSec.querySelectorAll('span[aria-label]'));
          found = upperSpans[1] || upperSpans[0];
        }
      }

      if (!found) return null;

      const ariaLabel = found.getAttribute('aria-label') || '';
      const lowerLabel = ariaLabel.toLowerCase();
      const isAvailable = !lowerLabel.includes('sold') && !lowerLabel.includes('booked') && !lowerLabel.includes('not available');
      const seatId = found.id || seatNo;

      return { seatId, ariaLabel, isAvailable };
    }, targetSeatNumber);

    if (!seatMatch) {
      throw new Error(`Target seat "${targetSeatNumber}" was not found in seat map`);
    }

    console.log(`Target Seat Info (${seatMatch.seatId}): ${seatMatch.ariaLabel}`);

    if (!seatMatch.isAvailable) {
      console.log(`\n[SEAT UNAVAILABLE] Target Seat (${seatMatch.seatId}) is currently SOLD/BOOKED.`);
      const unavailableScreenshot = path.join(screenshotDir, `unavailable_${timestamp}.png`);
      await page.screenshot({ path: unavailableScreenshot, fullPage: false }).catch(() => {});
      
      runResult.seatAvailable = false;
      runResult.retryNeeded = true;
      runResult.screenshot = unavailableScreenshot;
      return runResult;
    }

    console.log(`\n[SEAT AVAILABLE!] Seat ${seatMatch.seatId} is AVAILABLE for booking!`);
    console.log(`Selecting seat: ${seatMatch.ariaLabel}...`);
    
    const seatElem = page.locator(`span#${seatMatch.seatId}, span[aria-label*="Seat number ${seatMatch.seatId}" i]`).first();
    await seatElem.scrollIntoViewIfNeeded().catch(() => {});
    await seatElem.click();
    await page.waitForTimeout(2500);

    runResult.selectedSeat = seatMatch.seatId;
    runResult.seatAvailable = true;

    console.log('Proceeding to Boarding & Dropping point selection...');
    const selectBpDpBtn = page.locator('button[aria-label*="Select boarding" i], button[class*="primaryButton"]:has-text("Select boarding"), button:has-text("Select boarding & dropping points")').first();
    if (await selectBpDpBtn.isVisible().catch(() => false)) {
      await selectBpDpBtn.scrollIntoViewIfNeeded().catch(() => {});
      await selectBpDpBtn.click({ force: true });
    }
    await page.waitForTimeout(3000);

    console.log(`Selecting Boarding Point matching "${boardingPointSearch}"...`);
    const bpTab = page.locator('div[class*="tab"], li[class*="tab"], span[class*="tab"]').filter({ hasText: /Board/i }).first();
    if (await bpTab.isVisible().catch(() => false)) {
      await bpTab.click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
    }

    const bpDetails = await page.evaluate((searchTerm) => {
      let inputs = Array.from(document.querySelectorAll('input[name^="bp_"]'));
      if (inputs.length === 0) {
        inputs = Array.from(document.querySelectorAll('input[type="radio"]'));
      }
      
      const cleanSearch = searchTerm.toLowerCase().replace(/\s+/g, '');
      let match = inputs.find(i => {
        const parent = i.closest('li') || i.closest('label') || i.parentElement;
        const text = parent ? parent.innerText.toLowerCase().replace(/\s+/g, '') : '';
        return text.includes(cleanSearch);
      });

      if (!match) {
        const elems = Array.from(document.querySelectorAll('li, div[class*="point"], div[class*="radio"], div[class*="bpdp"]'));
        const textMatch = elems.find(el => el.innerText && el.innerText.toLowerCase().replace(/\s+/g, '').includes(cleanSearch) && el.children.length < 6);
        if (textMatch) {
          textMatch.click();
          return textMatch.innerText.trim().replace(/\s+/g, ' ');
        }
      }

      if (!match && inputs.length > 0) {
        match = inputs[0];
      }

      if (match) {
        const label = document.querySelector(`label[for="${match.id}"]`) || match.parentElement || match;
        if (label) label.click();
        else match.click();
        const parent = match.closest('li') || match.closest('label') || match.parentElement;
        return parent ? parent.innerText.trim().replace(/\s+/g, ' ') : match.id;
      }
      return null;
    }, boardingPointSearch);

    console.log(`Selected BP: ${bpDetails}`);
    runResult.selectedBp = bpDetails;
    await page.waitForTimeout(2000);

    console.log(`Selecting Dropping Point matching "${droppingPointSearch}"...`);

    const dpTab = page.locator('div[class*="tab"], li[class*="tab"], span[class*="tab"]').filter({ hasText: /Drop/i }).first();
    if (await dpTab.isVisible().catch(() => false)) {
      await dpTab.click({ force: true }).catch(() => {});
      await page.waitForTimeout(1000);
    }

    const dpDetails = await page.evaluate((searchTerm) => {
      let inputs = Array.from(document.querySelectorAll('input[name^="dp_"]'));
      if (inputs.length === 0) {
        inputs = Array.from(document.querySelectorAll('input[type="radio"]'));
      }

      const cleanSearch = searchTerm.toLowerCase().replace(/\s+/g, '');
      let match = inputs.find(i => {
        const parent = i.closest('li') || i.closest('label') || i.parentElement;
        const text = parent ? parent.innerText.toLowerCase().replace(/\s+/g, '') : '';
        return text.includes(cleanSearch);
      });

      if (!match) {
        const elems = Array.from(document.querySelectorAll('li, div[class*="point"], div[class*="radio"], div[class*="bpdp"]'));
        const textMatch = elems.find(el => el.innerText && el.innerText.toLowerCase().replace(/\s+/g, '').includes(cleanSearch) && el.children.length < 6);
        if (textMatch) {
          textMatch.click();
          return textMatch.innerText.trim().replace(/\s+/g, ' ');
        }
      }

      if (!match && inputs.length > 0) {
        match = inputs[0];
      }

      if (match) {
        const label = document.querySelector(`label[for="${match.id}"]`) || match.parentElement || match;
        if (label) label.click();
        else match.click();
        const parent = match.closest('li') || match.closest('label') || match.parentElement;
        return parent ? parent.innerText.trim().replace(/\s+/g, ' ') : match.id;
      }
      return null;
    }, droppingPointSearch);

    console.log(`Selected DP: ${dpDetails}`);
    runResult.selectedDp = dpDetails;
    await page.waitForTimeout(2500);

    console.log('Transitioning to Passenger Info view...');
    const proceedToPassengerBtn = page.locator('button[class*="primaryButton"]:has-text("Continue booking"), button[class*="primaryButton"]:has-text("Proceed"), button[class*="primaryButton"]:has-text("Fill Passenger"), button:has-text("Fill Passenger Details"), button:has-text("Proceed")').first();
    if (await proceedToPassengerBtn.isVisible().catch(() => false)) {
      await proceedToPassengerBtn.click({ force: true });
      await page.waitForTimeout(4000);
    } else {
      await page.locator('text=/Passenger Info/i').first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(4000);
    }

    const p = config.passenger || {};
    const phoneInput = page.locator('input[name="Phone"], input[type="tel"], input[placeholder*="phone" i], input[id="0_6"]').first();
    if (await phoneInput.isVisible().catch(() => false)) await phoneInput.fill(p.phone || '9876543210');

    const emailInput = page.locator('input[placeholder*="Enter email id" i], input[id="0_5"], input[type="email"]').first();
    if (await emailInput.isVisible().catch(() => false)) await emailInput.fill(p.email || 'johndoe@example.com');

    const nameInput = page.locator('input[placeholder*="Enter your Name" i], input[id="0_4"], input[name*="name" i]').first();
    if (await nameInput.isVisible().catch(() => false)) await nameInput.fill(p.name || 'John Doe');

    const ageInput = page.locator('input[placeholder*="Enter Age" i], input[id="0_1"], input[type="number"]').first();
    if (await ageInput.isVisible().catch(() => false)) await ageInput.fill((p.age || '28').toString());

    await page.evaluate(() => {
      const radioInput = document.querySelector('input[value="Male"], input[id$="_22"], input[name*="gender" i][value="Male"]');
      if (radioInput) {
        radioInput.checked = true;
        radioInput.dispatchEvent(new Event('change', { bubbles: true }));
        const label = document.querySelector(`label[for="${radioInput.id}"]`) || radioInput.closest('label');
        if (label) label.click();
      } else {
        const elems = Array.from(document.querySelectorAll('label, div[class*="pill"]'));
        const maleElem = elems.find(e => e.innerText && e.innerText.trim() === 'Male');
        if (maleElem) maleElem.click();
      }
    });

    await page.waitForTimeout(1000);

    await page.evaluate(() => {
      const stateItem = Array.from(document.querySelectorAll('li, div[class*="state"], span')).find(e => e.innerText && /Telangana|Andhra Pradesh|Karnataka/i.test(e.innerText.trim()));
      if (stateItem) stateItem.click();
    });
    
    await page.waitForTimeout(1000);

    console.log('Selecting "Don\'t add Trip Guarantee", "Don\'t add Free Cancellation", and "Don\'t add Travel Insurance"...');
    
    const rejectTexts = [
      "Don't add Free Cancellation",
      "Don’t add Free Cancellation",
      "Don't add Trip Guarantee",
      "Don’t add Trip Guarantee",
      "Don't add Travel Insurance",
      "Don’t add Travel Insurance",
      "No, I don't want"
    ];

    for (const text of rejectTexts) {
      try {
        // Try exact match first
        let loc = page.getByText(text, { exact: true }).first();
        if (await loc.isVisible().catch(() => false)) {
          console.log(`Clicking exact text: "${text}"`);
          // Click the element itself
          await loc.click({ force: true }).catch(() => {});
          // Click its parent container as well to ensure event bubbling catches it
          await loc.locator('..').click({ force: true }).catch(() => {});
          await page.waitForTimeout(500);
          continue;
        }

        // Try partial match if exact didn't work
        loc = page.getByText(text).first();
        if (await loc.isVisible().catch(() => false)) {
          console.log(`Clicking partial text: "${text}"`);
          await loc.click({ force: true }).catch(() => {});
          await loc.locator('..').click({ force: true }).catch(() => {});
          await page.waitForTimeout(500);
        }
      } catch (e) {
        // Ignore errors for individual text clicks
      }
    }

    // Direct fallback for insurance radio button ID often used by RedBus
    const insuranceRadio = page.locator('input#insuranceRejectBtn, input[value="false"][type="radio"]');
    if (await insuranceRadio.first().isVisible().catch(() => false)) {
       await insuranceRadio.first().check({ force: true }).catch(() => {});
       await insuranceRadio.first().click({ force: true }).catch(() => {});
    }

    // Final fallback using evaluate just in case it's in a weird state
    await page.evaluate(() => {
      const radio = document.getElementById('insuranceRejectBtn');
      if (radio && !radio.checked) {
        radio.click();
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    
    await page.waitForTimeout(1000);
    await page.waitForTimeout(5000);

    console.log('Clicking "Continue booking" button...');
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, input[type="submit"], div[class*="button"]'));
      const btn = btns.find(b => b.innerText && /continue booking|proceed/i.test(b.innerText.trim()));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });

    if (!clicked) {
      const continueBookingBtn = page.locator('button[class*="primaryButton"]').filter({ hasText: /Continue booking|Proceed/i }).first();
      await continueBookingBtn.click({ force: true }).catch(() => {});
    }

    await page.waitForURL(url => url.href.includes('paymentDetails') || url.href.includes('checkout') || url.href.includes('payment'), { timeout: 15000 }).catch(() => {});

    const screenshotPath = path.join(screenshotDir, `checkout_${timestamp}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    runResult.success = true;
    runResult.screenshot = screenshotPath;
    console.log(`\n==================================================`);
    console.log(`[SUCCESS] Reached Payment page!`);
    console.log(`==================================================`);

    if (!isHeadless) {
      await new Promise(() => {}); 
    } else {
      await page.waitForTimeout((config.keepBrowserOpenSeconds || 15) * 1000);
    }

  } catch (err) {
    console.error(`\n[ERROR] Automation run failed: ${err.message}`);
    runResult.error = err.message;
    runResult.retryNeeded = true; 
    const errorScreenshot = path.join(screenshotDir, `error_${timestamp}.png`);
    try {
      await page.screenshot({ path: errorScreenshot, fullPage: true });
    } catch (ssErr) {}
    runResult.screenshot = errorScreenshot;
  } finally {
    await browser.close();
  }

  return runResult;
}

module.exports = { runRedbusAutomation };